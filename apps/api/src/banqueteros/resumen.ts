import type { PrismaClient } from '@hsa/database';
import { hoyCivilMexico } from '@hsa/shared';
import { saldoSinAsignar } from './cuenta.js';
import { apartadoVivo } from './apartados.js';
import { totalAbonado } from './abonos.js';
import { DIAS_POR_VENCER } from './estadoCuenta.js';

/**
 * El resumen de TODOS los banqueteros en una sola consulta.
 *
 * Existe porque dos pantallas piden lo mismo y ninguna puede pagar una llamada
 * por banquetero: la lista de admin (nombre, eventos, saldo sin asignar,
 * apartados por vencer) y el tablero (el saldo sin asignar como alerta). Con
 * `GET /banqueteros/:id/estado-cuenta` por cada uno, diez banqueteros costarían
 * diez veces `loadEstadoCuentaBulk` sobre toda su cartera para pintar una lista.
 *
 * **NO filtra por pertenencia**, por la misma razón que el estado de cuenta:
 * el saldo sin asignar de una contraparte es uno solo y es dinero de la hacienda
 * sin destino, no una cifra de ventas de nadie. Un "saldo de lo mío" no cuadraría
 * contra el banco.
 */

export interface ResumenBanquetero {
  banqueteroId: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  activo: boolean;
  publicToken: string;
  /** Cotizaciones vivas suyas (sin papelera). Los apartados NO cuentan: no son ventas. */
  eventos: number;
  /** Σ depósitos vivos. */
  depositado: number;
  /** Σ depósitos vivos − Σ asignaciones vivas. El número que justifica el plan. */
  saldoSinAsignar: number;
  apartadosVivos: number;
  apartadosPorVencer: number;
  /** El vencimiento más próximo de sus apartados vivos, para poder ordenar por urgencia. */
  proximoVencimientoISO: string | null;
}

/** Un apartado vivo sin convertir, con su urgencia ya calculada. */
export interface ApartadoPendiente {
  apartadoId: string;
  banqueteroId: string;
  banquetero: string;
  fechaEventoISO: string;
  venceISO: string;
  /** Negativo nunca: un apartado vencido ya no está vivo y no llega aquí. */
  diasParaVencer: number;
  /** Lo que lleva juntado esa fecha, sumando sus abonos vivos. */
  abonado: number;
  spaceIds: string[];
  catalogo: string | null;
  nota: string | null;
}

const MS_DIA = 86_400_000;

export async function resumenBanqueteros(
  db: PrismaClient,
  opts: { hoy?: Date } = {},
): Promise<{ banqueteros: ResumenBanquetero[]; apartados: ApartadoPendiente[]; totalSinAsignar: number }> {
  const hoy = opts.hoy ?? hoyCivilMexico();

  const [banqueteros, depositos, apartados, gruposEventos] = await Promise.all([
    db.banquetero.findMany({ orderBy: { nombre: 'asc' } }),
    db.pagoBanquetero.findMany({
      select: {
        banqueteroId: true,
        monto: true,
        anuladoAt: true,
        asignaciones: { select: { monto: true, anuladoAt: true } },
      },
    }),
    db.apartadoFecha.findMany({
      include: {
        banquetero: { select: { nombre: true } },
        priceList: { select: { nombre: true } },
        abonos: { select: { monto: true, anuladoAt: true } },
      },
      orderBy: { vence: 'asc' },
    }),
    // La papelera no cuenta: es evidencia de auditoría, no cartera viva.
    db.quote.groupBy({
      by: ['banqueteroId'],
      where: { banqueteroId: { not: null }, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const eventosPorBanquetero = new Map(
    gruposEventos.map((g) => [g.banqueteroId as string, g._count._all]),
  );

  const limite = new Date(hoy);
  limite.setUTCDate(limite.getUTCDate() + DIAS_POR_VENCER);

  const vivos = apartados.filter((a) => apartadoVivo(a, hoy));

  const pendientes: ApartadoPendiente[] = vivos.map((a) => ({
    apartadoId: a.id,
    banqueteroId: a.banqueteroId,
    banquetero: a.banquetero?.nombre ?? 'Banquetero',
    fechaEventoISO: a.fechaEvento.toISOString(),
    venceISO: a.vence.toISOString(),
    diasParaVencer: Math.round((a.vence.getTime() - hoy.getTime()) / MS_DIA),
    abonado: totalAbonado(a.abonos),
    spaceIds: a.spaceIds,
    catalogo: a.priceList?.nombre ?? null,
    nota: a.nota,
  }));

  const resumen: ResumenBanquetero[] = banqueteros.map((b) => {
    const suyos = depositos.filter((d) => d.banqueteroId === b.id);
    const misApartados = vivos.filter((a) => a.banqueteroId === b.id);
    return {
      banqueteroId: b.id,
      nombre: b.nombre,
      telefono: b.telefono,
      correo: b.correo,
      activo: b.activo,
      publicToken: b.publicToken,
      eventos: eventosPorBanquetero.get(b.id) ?? 0,
      depositado: suyos.filter((d) => d.anuladoAt == null).reduce((s, d) => s + d.monto, 0),
      saldoSinAsignar: suyos.reduce((s, d) => s + saldoSinAsignar(d, d.asignaciones), 0),
      apartadosVivos: misApartados.length,
      apartadosPorVencer: misApartados.filter((a) => a.vence.getTime() <= limite.getTime()).length,
      // `vivos` ya viene ordenado por `vence` asc desde la consulta.
      proximoVencimientoISO: misApartados[0]?.vence.toISOString() ?? null,
    };
  });

  return {
    banqueteros: resumen,
    apartados: pendientes,
    totalSinAsignar: resumen.reduce((s, r) => s + r.saldoSinAsignar, 0),
  };
}
