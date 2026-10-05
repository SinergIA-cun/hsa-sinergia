import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { emparejarNombre, formatFolio, resolverFormasPago, FormasPagoError, ESTATUS_SIN_FECHA } from '@hsa/shared';
import { cargarCatalogos, pagoBISchema, type Candidato, type Catalogos } from './importar.js';
import { apartadoVivo } from '../banqueteros/apartados.js';
import { INCLUDE_TITULAR, titularDeApartado } from '../banqueteros/titular.js';
import { subirSecuenciaSobre } from '../payments/folios.js';

/**
 * El BI manda sus fechas APARTADAS: pagadas pero sin todos los datos del evento
 * (falta el precio, los invitados o los dos). Tarea C5 del encargo del BI.
 *
 * Mismas reglas que la importación de eventos (`importar.ts`):
 *  - **Idempotente por `idBI`.** Mandar el mismo lote dos veces no duplica nada.
 *  - **Nunca pisa.** Lo que ya existe se compara y las diferencias se REPORTAN.
 *  - **Ante la duda, no importa.** Una fecha y salón ya ocupados salen
 *    `posibleDuplicado`; un salón o banquetero que no se reconoce, `invalido`.
 *
 * Un apartado importado **no vence antes de su fecha** (decisión del dueño,
 * 5-oct-2026): su `vence` es el día del evento. Uno capturado aquí sigue con
 * los siete días hábiles de siempre.
 */

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD');

export const apartadoBISchema = z
  .object({
    idBI: z.string().min(1).max(100),
    fecha: fechaISO,
    salones: z.array(z.string().min(1).max(80)).min(1).max(3),
    tipoEvento: z.string().min(1).max(80).nullish(),
    /** Quién apartó: un banquetero (por nombre) O un cliente directo. Exactamente uno. */
    banquetero: z.string().min(1).max(200).nullish(),
    cliente: z
      .object({
        nombre: z.string().trim().min(1).max(200),
        telefono: z.string().max(30).nullish(),
        correo: z.string().max(200).nullish(),
      })
      .nullish(),
    precioAcordado: z.number().int().positive().nullish(),
    nota: z.string().max(500).nullish(),
    pagos: z.array(pagoBISchema).max(100).default([]),
  })
  .refine((a) => (a.banquetero ? 1 : 0) + (a.cliente ? 1 : 0) === 1, {
    message: 'Un apartado lleva banquetero o cliente, exactamente uno.',
    path: ['banquetero'],
  });

export const loteApartadosSchema = z.object({
  apartados: z.array(apartadoBISchema).min(1).max(200),
  /** Hasta qué fecha tiene pagos el BI: del lado de la hacienda solo se comparan esos. */
  pagosHasta: fechaISO.optional(),
});

export type ApartadoBI = z.infer<typeof apartadoBISchema>;

export type EstadoApartado = 'nuevo' | 'igual' | 'difiere' | 'posibleDuplicado' | 'invalido';

export interface DiferenciaApartado {
  campo: 'fecha' | 'salones' | 'titular' | 'precioAcordado' | 'pagado' | 'folios';
  bi: unknown;
  hsa: unknown;
}

export interface ResultadoApartado {
  idBI: string;
  estado: EstadoApartado;
  apartadoId?: string;
  diferencias?: DiferenciaApartado[];
  candidatos?: Candidato[];
  errores?: string[];
  avisos?: string[];
  accion?: 'creado';
}

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Traduce los nombres del BI a los registros de aquí. */
function resolver(a: ApartadoBI, c: Catalogos) {
  const errores: string[] = [];
  const avisos: string[] = [];
  const spaceIds: string[] = [];
  for (const s of a.salones) {
    const hit = emparejarNombre(s, c.espacios);
    if (hit) spaceIds.push(hit.id);
    else errores.push(`El salón "${s}" no se reconoce.`);
  }
  let eventTypeId: string | null = null;
  if (a.tipoEvento) {
    const t = emparejarNombre(a.tipoEvento, c.tipos);
    if (t) eventTypeId = t.id;
    else avisos.push(`El tipo de evento "${a.tipoEvento}" no se reconoce: el apartado entra sin tipo.`);
  }
  let banqueteroId: string | null = null;
  if (a.banquetero) {
    const b = emparejarNombre(a.banquetero, c.banqueteros);
    // Sin banquetero el apartado no tiene dueño: no se puede crear. Se dan de
    // alta primero con /importar/banqueteros.
    if (b) banqueteroId = b.id;
    else errores.push(`El banquetero "${a.banquetero}" no está dado de alta. Mándalo antes por /importar/banqueteros.`);
  }
  for (const p of a.pagos) {
    try {
      resolverFormasPago({ monto: p.monto, metodo: p.metodo, formas: p.formas });
    } catch (e) {
      if (e instanceof FormasPagoError) errores.push(`Pago con folio I ${p.folio}: ${e.message}`);
      else throw e;
    }
  }
  const repetidos = a.pagos.map((p) => p.folio).filter((f, i, arr) => arr.indexOf(f) !== i);
  if (repetidos.length) errores.push(`Folios repetidos en los pagos: ${[...new Set(repetidos)].join(', ')}.`);
  return { errores, avisos, spaceIds, eventTypeId, banqueteroId };
}

type Resuelto = ReturnType<typeof resolver>;

/** Folios del lote que ya tiene OTRO dinero aquí: importarlos duplicaría un recibo. */
async function foliosOcupados(db: PrismaClient, folios: number[], salvoApartadoId?: string): Promise<number[]> {
  if (folios.length === 0) return [];
  const [pagos, depositos, abonos] = await Promise.all([
    db.payment.findMany({ where: { folio: { in: folios } }, select: { folio: true } }),
    db.pagoBanquetero.findMany({ where: { folio: { in: folios } }, select: { folio: true } }),
    db.abonoApartado.findMany({
      where: { folio: { in: folios }, ...(salvoApartadoId ? { apartadoId: { not: salvoApartadoId } } : {}) },
      select: { folio: true },
    }),
  ]);
  return [...new Set([...pagos, ...depositos, ...abonos].map((x) => x.folio).filter((f): f is number => f != null))];
}

async function conciliarUno(
  db: PrismaClient,
  a: ApartadoBI,
  c: Catalogos,
  pagosHasta: string | undefined,
): Promise<ResultadoApartado & { _resuelto?: Resuelto }> {
  const r = resolver(a, c);
  if (r.errores.length) return { idBI: a.idBI, estado: 'invalido', errores: r.errores, avisos: r.avisos };

  const existente = await db.apartadoFecha.findUnique({
    where: { importadoBI: a.idBI },
    include: { ...INCLUDE_TITULAR, abonos: { select: { folio: true, monto: true, fecha: true, anuladoAt: true } } },
  });
  if (existente) {
    const diferencias: DiferenciaApartado[] = [];
    const hsaFecha = existente.fechaEvento.toISOString().slice(0, 10);
    if (hsaFecha !== a.fecha) diferencias.push({ campo: 'fecha', bi: a.fecha, hsa: hsaFecha });
    const mismosSalones =
      existente.spaceIds.length === r.spaceIds.length && r.spaceIds.every((id) => existente.spaceIds.includes(id));
    if (!mismosSalones) {
      const nombre = (id: string) => c.espacios.find((e) => e.id === id)?.nombre ?? id;
      diferencias.push({ campo: 'salones', bi: r.spaceIds.map(nombre), hsa: existente.spaceIds.map(nombre) });
    }
    const titularBI = a.banquetero ?? a.cliente?.nombre ?? '';
    const titularHSA = titularDeApartado(existente);
    if (r.banqueteroId ? existente.banqueteroId !== r.banqueteroId : existente.clientId == null) {
      diferencias.push({ campo: 'titular', bi: titularBI, hsa: titularHSA });
    }
    if ((a.precioAcordado ?? null) !== existente.precioAcordado) {
      diferencias.push({ campo: 'precioAcordado', bi: a.precioAcordado ?? null, hsa: existente.precioAcordado });
    }
    const hasta = pagosHasta ? dia(pagosHasta).getTime() : Infinity;
    const vivos = existente.abonos.filter((x) => x.anuladoAt == null && x.fecha.getTime() <= hasta);
    const pagadoHSA = vivos.reduce((s, x) => s + x.monto, 0);
    const pagadoBI = a.pagos.reduce((s, p) => s + p.monto, 0);
    if (pagadoHSA !== pagadoBI) diferencias.push({ campo: 'pagado', bi: pagadoBI, hsa: pagadoHSA });
    const fHSA = vivos.map((x) => x.folio).filter((f): f is number => f != null);
    const fBI = a.pagos.map((p) => p.folio);
    const soloBI = fBI.filter((f) => !fHSA.includes(f));
    const soloHSA = fHSA.filter((f) => !fBI.includes(f));
    if (soloBI.length || soloHSA.length) diferencias.push({ campo: 'folios', bi: soloBI, hsa: soloHSA });
    return {
      idBI: a.idBI,
      estado: diferencias.length ? 'difiere' : 'igual',
      apartadoId: existente.id,
      diferencias,
      avisos: r.avisos,
    };
  }

  const ocupados = await foliosOcupados(db, a.pagos.map((p) => p.folio));
  if (ocupados.length) {
    return {
      idBI: a.idBI,
      estado: 'invalido',
      errores: [`Folios que ya tiene otro dinero aquí: ${ocupados.map((f) => formatFolio(f)).join(', ')}.`],
      avisos: r.avisos,
    };
  }

  // ¿Ya hay algo esa fecha en ese salón? Un evento vivo o un apartado vivo.
  const fecha = dia(a.fecha);
  const [eventos, apartados] = await Promise.all([
    db.quote.findMany({
      where: {
        fechaEvento: fecha,
        deletedAt: null,
        status: { notIn: [...ESTATUS_SIN_FECHA] },
        spaceIds: { hasSome: r.spaceIds },
      },
      select: { id: true, folio: true, status: true, client: { select: { nombre: true } } },
    }),
    db.apartadoFecha.findMany({
      where: { fechaEvento: fecha, quoteId: null, canceladoAt: null, spaceIds: { hasSome: r.spaceIds } },
      select: { id: true, canceladoAt: true, quoteId: true, vence: true, ...INCLUDE_TITULAR },
    }),
  ]);
  const candidatos: Candidato[] = [
    ...eventos.map((q) => ({ tipo: 'evento' as const, id: q.id, folio: q.folio, cliente: q.client?.nombre ?? null, estatus: q.status })),
    ...apartados
      .filter((x) => apartadoVivo(x))
      .map((x) => ({ tipo: 'apartado' as const, id: x.id, folio: null, cliente: titularDeApartado(x), estatus: 'apartado' })),
  ];
  if (candidatos.length) {
    return {
      idBI: a.idBI,
      estado: 'posibleDuplicado',
      candidatos,
      avisos: [...r.avisos, 'Ya hay algo aquí en esa fecha y salón. Lo revisa una persona; no se importa.'],
    };
  }
  return { idBI: a.idBI, estado: 'nuevo', avisos: r.avisos, _resuelto: r };
}

/** El cliente directo: se reutiliza solo si el teléfono coincide EXACTO, como en eventos. */
async function clienteDelApartado(db: PrismaClient, cliente: NonNullable<ApartadoBI['cliente']>): Promise<string> {
  const tel = cliente.telefono?.replace(/\D/g, '') || null;
  if (tel) {
    const existentes = await db.client.findMany({ where: { telefono: { not: null } }, select: { id: true, telefono: true } });
    const hit = existentes.find((cl) => cl.telefono?.replace(/\D/g, '') === tel);
    if (hit) return hit.id;
  }
  const creado = await db.client.create({
    data: { nombre: cliente.nombre, telefono: cliente.telefono ?? null, correo: cliente.correo ?? null },
    select: { id: true },
  });
  return creado.id;
}

async function crear(db: PrismaClient, a: ApartadoBI, r: Resuelto): Promise<string> {
  const clientId = a.cliente ? await clienteDelApartado(db, a.cliente) : null;
  const creado = await db.apartadoFecha.create({
    data: {
      banqueteroId: r.banqueteroId,
      clientId,
      fechaEvento: dia(a.fecha),
      spaceIds: r.spaceIds,
      eventTypeId: r.eventTypeId,
      precioAcordado: a.precioAcordado ?? null,
      // No vence antes de su fecha: es una fecha ya pagada, no una reserva de días.
      vence: dia(a.fecha),
      nota: a.nota ?? null,
      importadoBI: a.idBI,
      abonos: {
        create: a.pagos.map((p) => {
          const forma = resolverFormasPago({ monto: p.monto, metodo: p.metodo, formas: p.formas });
          return {
            monto: p.monto,
            metodo: forma.metodo,
            formas: forma.formas ?? undefined,
            fecha: dia(p.fecha),
            referencia: p.referencia ?? null,
            // El folio de la hoja de papel: es el número que ya tiene el cliente.
            folio: p.folio,
          };
        }),
      },
    },
    select: { id: true },
  });
  const max = Math.max(0, ...a.pagos.map((p) => p.folio));
  if (max > 0) await subirSecuenciaSobre(db, max);
  return creado.id;
}

function resumen(resultados: ResultadoApartado[]) {
  const conteo: Partial<Record<EstadoApartado | 'creados', number>> = {};
  for (const r of resultados) {
    conteo[r.estado] = (conteo[r.estado] ?? 0) + 1;
    if (r.accion === 'creado') conteo.creados = (conteo.creados ?? 0) + 1;
  }
  return conteo;
}

const sinInterno = ({ _resuelto, ...r }: ResultadoApartado & { _resuelto?: unknown }): ResultadoApartado => {
  void _resuelto;
  return r;
};

/** Compara el lote con la base. No escribe NADA. */
export async function conciliarApartados(db: PrismaClient, raw: unknown) {
  const lote = loteApartadosSchema.parse(raw);
  const c = await cargarCatalogos(db);
  const resultados: ResultadoApartado[] = [];
  for (const a of lote.apartados) resultados.push(sinInterno(await conciliarUno(db, a, c, lote.pagosHasta)));
  return { resumen: resumen(resultados), resultados };
}

/** Crea los `nuevo`. Lo demás se reporta igual que en `conciliar`. */
export async function importarApartados(db: PrismaClient, raw: unknown) {
  const lote = loteApartadosSchema.parse(raw);
  const c = await cargarCatalogos(db);
  const resultados: ResultadoApartado[] = [];
  for (const a of lote.apartados) {
    const res = await conciliarUno(db, a, c, lote.pagosHasta);
    if (res.estado === 'nuevo' && res._resuelto) {
      const apartadoId = await crear(db, a, res._resuelto);
      resultados.push({ ...sinInterno(res), apartadoId, accion: 'creado' });
      continue;
    }
    resultados.push(sinInterno(res));
  }
  return { resumen: resumen(resultados), resultados };
}
