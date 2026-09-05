import { z } from 'zod';
import { normalizaTexto } from '@hsa/shared';
import type { PrismaClient, Prisma } from '@hsa/database';
import type { FotoEvento } from './foto.js';

const POR_PAGINA = 40;

export const consultaSchema = z.object({
  q: z.string().max(120).optional(),
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  /**
   * `true` = solo los eventos que **se realizaron** y quedaron debiendo. Es la
   * pregunta incómoda del archivo.
   *
   * Se exige `seRealizo` a propósito: un borrador que nunca cerró tiene el total
   * completo como saldo, pero nadie debe nada — no hubo evento. Mezclarlos
   * convertiría la lista de cobros perdidos en una lista de cotizaciones que no
   * prosperaron, que es otra cosa y mucho más larga.
   */
  soloConSaldo: z.coerce.boolean().optional(),
  /** `false` = los que no se realizaron (quedaron en borrador). */
  seRealizo: z.coerce.boolean().optional(),
  pagina: z.coerce.number().int().min(0).default(0),
});

export type Consulta = z.infer<typeof consultaSchema>;

export interface RenglonHistorico {
  id: string;
  quoteId: string;
  version: number;
  /** Cuántas versiones tiene en total: >1 significa que se corrigió después. */
  versiones: number;
  fechaEventoISO: string;
  folio: string | null;
  etiqueta: string | null;
  cliente: string;
  banquetero: string | null;
  eventoTipo: string;
  espacios: string[];
  total: number;
  pagado: number;
  saldo: number;
  seRealizo: boolean;
  liquidado: boolean;
}

/**
 * El archivo, buscable.
 *
 * Devuelve **la última versión de cada evento**, no todas: la lista es "qué pasó
 * ese día", y enseñar tres versiones del mismo evento como tres renglones haría
 * imposible contar. Las versiones anteriores se ven al abrir la foto.
 */
export async function listarHistorico(
  db: PrismaClient,
  q: Consulta,
): Promise<{ filas: RenglonHistorico[]; total: number; hayMas: boolean; anios: number[] }> {
  const where: Prisma.EventoHistoricoWhereInput = {
    ...(q.q ? { busqueda: { contains: normalizaTexto(q.q) } } : {}),
    ...(q.seRealizo != null ? { seRealizo: q.seRealizo } : {}),
    ...(q.soloConSaldo ? { saldo: { gt: 0 }, seRealizo: true } : {}),
    ...(q.anio
      ? {
          fechaEvento: {
            gte: new Date(Date.UTC(q.anio, 0, 1)),
            lt: new Date(Date.UTC(q.anio + 1, 0, 1)),
          },
        }
      : {}),
  };

  // Solo la última versión de cada evento. La lista responde "qué pasó ese día":
  // enseñar tres versiones del mismo evento como tres renglones haría imposible
  // contar, y el filtro por saldo significaría "debía en ALGUNA versión" en vez
  // de "quedó debiendo al final".
  //
  // `DISTINCT ON` es la herramienta de Postgres para esto y Prisma no la tiene.
  // Se pide en crudo solo los ids —no las filas— y el resto de la consulta sigue
  // siendo Prisma, con sus filtros y su paginación.
  const ultimas = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT ON ("quoteId") "id" FROM "EventoHistorico"
    ORDER BY "quoteId", "version" DESC
  `;
  if (ultimas.length === 0) return { filas: [], total: 0, hayMas: false, anios: [] };
  const filtroUltimas: Prisma.EventoHistoricoWhereInput = {
    id: { in: ultimas.map((u) => u.id) },
  };

  const condicion: Prisma.EventoHistoricoWhereInput = { AND: [where, filtroUltimas] };

  const [total, filas, todasLasFechas] = await Promise.all([
    db.eventoHistorico.count({ where: condicion }),
    db.eventoHistorico.findMany({
      where: condicion,
      orderBy: { fechaEvento: 'desc' },
      skip: q.pagina * POR_PAGINA,
      take: POR_PAGINA,
    }),
    db.eventoHistorico.findMany({ where: filtroUltimas, select: { fechaEvento: true } }),
  ]);

  const anios = [...new Set(todasLasFechas.map((f) => f.fechaEvento.getUTCFullYear()))].sort(
    (a, b) => b - a,
  );

  // Cuántas versiones tiene cada evento de esta página: es la marca de "esto se
  // corrigió después", que es justo lo que alguien busca en un archivo.
  const conteos = await db.eventoHistorico.groupBy({
    by: ['quoteId'],
    where: { quoteId: { in: filas.map((f) => f.quoteId) } },
    _count: { _all: true },
  });
  const versionesPorQuote = new Map(conteos.map((c) => [c.quoteId, c._count._all]));

  return {
    total,
    hayMas: (q.pagina + 1) * POR_PAGINA < total,
    anios,
    filas: filas.map((f) => ({
      id: f.id,
      quoteId: f.quoteId,
      version: f.version,
      versiones: versionesPorQuote.get(f.quoteId) ?? 1,
      fechaEventoISO: f.fechaEvento.toISOString(),
      folio: f.folio,
      etiqueta: f.etiqueta,
      cliente: f.cliente,
      banquetero: f.banquetero,
      eventoTipo: f.eventoTipo,
      espacios: f.espacios,
      total: f.total,
      pagado: f.pagado,
      saldo: f.saldo,
      seRealizo: f.seRealizo,
      liquidado: f.liquidado,
    })),
  };
}

export interface DetalleHistorico {
  id: string;
  quoteId: string;
  version: number;
  motivo: string;
  tomadaEnISO: string;
  foto: FotoEvento;
  /** Todas las versiones del mismo evento, de la más nueva a la más vieja. */
  versiones: { id: string; version: number; motivo: string; tomadaEnISO: string }[];
}

export async function detalleHistorico(
  db: PrismaClient,
  id: string,
): Promise<DetalleHistorico | null> {
  const fila = await db.eventoHistorico.findUnique({ where: { id } });
  if (!fila) return null;
  const hermanas = await db.eventoHistorico.findMany({
    where: { quoteId: fila.quoteId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, motivo: true, foto: true, createdAt: true },
  });
  const foto = fila.foto as unknown as FotoEvento;
  return {
    id: fila.id,
    quoteId: fila.quoteId,
    version: fila.version,
    motivo: fila.motivo,
    tomadaEnISO: foto.tomadaEnISO,
    foto,
    versiones: hermanas.map((h) => ({
      id: h.id,
      version: h.version,
      motivo: h.motivo,
      tomadaEnISO: (h.foto as unknown as FotoEvento).tomadaEnISO ?? h.createdAt.toISOString(),
    })),
  };
}
