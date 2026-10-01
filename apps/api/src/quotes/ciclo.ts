import { z } from 'zod';
import { enTransaccionConActor, type PrismaClient, type QuoteStatus } from '@hsa/database';
import {
  calcularCancelacion,
  pendientePorDevolver,
  metodoCapturaSchema,
  formasPagoSchema,
  sueltaLaFecha,
} from '@hsa/shared';
import {
  QuoteError,
  assertNotTrashed,
  assertEspaciosDisponibles,
  includeRels,
  loadEstadoCuenta,
  moveQuoteDate,
  ownershipWhere,
  type Actor,
} from './service.js';
import { esUpgrade } from './estadoCuenta.js';
import { logActivity } from './activityLog.js';
import { calcularCodigo, motivosDelCambio, renglonDeCodigo } from './codigo.js';
import { devolverACliente } from '../devoluciones/service.js';

/**
 * Cancelar, poner en standby y reprogramar un evento (decisión del dueño,
 * 1-oct-2026: "un evento debe poderse cancelar, poner en standby, o mover de
 * fecha de manera sencilla").
 *
 * - **Cancelar** suelta la fecha y decide qué pasa con el dinero: qué porcentaje
 *   de lo pagado se devuelve. La devolución se puede registrar en el momento o
 *   después; lo acordado queda guardado y la pantalla dice cuánto falta.
 * - **Standby** suelta la fecha sin cancelar: el cliente pospuso y no sabe
 *   cuándo. El evento queda en la lista "Sin fecha" con su dinero intacto.
 * - **Reprogramar** le pone fecha nueva a un evento con fecha, en standby o (un
 *   admin) cancelado. Revisa que la fecha esté libre, recalcula el precio por el
 *   tipo de día o respeta el pactado, y el código del evento cambia con su rastro.
 */

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD');
const motivo = z.string().trim().min(3, 'Escribe el motivo.').max(300);

export const cancelarSchema = z.object({
  motivo,
  /** Qué porcentaje de lo pagado se le devuelve (0..100). */
  porcentaje: z.number().min(0).max(100),
  /** Si viene, la devolución se registra en el mismo momento. */
  devolucion: z
    .object({
      metodo: metodoCapturaSchema.optional(),
      formas: formasPagoSchema.optional(),
      fecha: fechaISO,
      referencia: z.string().max(120).optional(),
    })
    .optional(),
});

export const standbySchema = z.object({ motivo });

export const reprogramarSchema = z.object({
  fecha: fechaISO,
  /**
   * Respetar el precio pactado en vez de recotizar por el tipo de día. Un evento
   * liquidado o importado del BI siempre lo respeta.
   */
  conservarPrecio: z.boolean().default(false),
});

/** Los cuatro estatus "con fecha", que son a los que se puede volver. */
const CON_FECHA = new Set<QuoteStatus>(['borrador', 'formalizada', 'complementada', 'liquidada']);

async function cargar(db: PrismaClient, id: string, actor: Actor) {
  const q = await db.quote.findFirst({
    where: { id, ...ownershipWhere(actor) },
    include: { client: { select: { nombre: true } } },
  });
  if (!q) throw new QuoteError(404, 'Evento no encontrado');
  assertNotTrashed(q);
  return q;
}

const pesos = (n: number) => `$${n.toLocaleString('es-MX')}`;

export async function cancelarEvento(db: PrismaClient, id: string, raw: unknown, actor: Actor) {
  const input = cancelarSchema.parse(raw);
  const q = await cargar(db, id, actor);
  if (q.status === 'cancelada') throw new QuoteError(409, 'El evento ya está cancelado.');

  const { estadoCuenta } = await loadEstadoCuenta(db, q);
  const c = calcularCancelacion(estadoCuenta.pagado, input.porcentaje);
  // Con dinero de por medio decide un admin: es él quien responde por lo que se
  // devuelve y por lo que se retiene. Un borrador sin pagos lo cancela quien lo hizo.
  if (c.pagado > 0 && actor.role !== 'admin') {
    throw new QuoteError(403, 'El evento tiene pagos: solo un admin lo puede cancelar.');
  }
  if (input.devolucion && c.devolver === 0) {
    throw new QuoteError(400, 'Con lo acordado no hay nada que devolver.');
  }

  // Si estaba en standby, el estatus al que volvería es el de antes del standby.
  const previo = q.status === 'standby' ? q.statusPrevio : q.status;
  // La hora se toma ANTES de abrir la transacción: Postgres fecha las filas
  // nuevas con la hora en que empezó la transacción, y la devolución que se
  // registre aquí mismo tiene que quedar después de la cancelación (es lo que
  // `resumenCancelacion` cuenta como "ya devuelto").
  const canceladaAt = new Date();

  return enTransaccionConActor(
    async (txRaw) => {
      const tx = txRaw as unknown as PrismaClient;
      await tx.quote.update({
        where: { id },
        data: {
          status: 'cancelada',
          statusPrevio: previo,
          canceladaAt,
          cancelacionMotivo: input.motivo,
          cancelacionPct: input.porcentaje,
          cancelacionPagado: c.pagado,
          cancelacionDevolver: c.devolver,
          standbyDesde: null,
          standbyMotivo: null,
        },
      });
      await logActivity(tx, {
        quoteId: id,
        tipo: 'cancelada',
        descripcion:
          `Evento cancelado: ${input.motivo}. Pagado ${pesos(c.pagado)}; se devuelve el ${input.porcentaje}% ` +
          `(${pesos(c.devolver)}) y se retiene ${pesos(c.retenido)}.`,
        meta: { de: q.status, motivo: input.motivo, ...c },
        actorId: actor.id,
      });
      const devolucion = input.devolucion
        ? await devolverACliente(
            tx,
            id,
            { ...input.devolucion, monto: c.devolver, destino: 'evento', motivo: `Cancelación: ${input.motivo}` },
            actor,
          )
        : null;
      const quote = await tx.quote.findUniqueOrThrow({ where: { id }, include: includeRels });
      return { quote, cancelacion: c, devolucion };
    },
    db,
    { timeout: 20_000 },
  );
}

export async function ponerEnStandby(db: PrismaClient, id: string, raw: unknown, actor: Actor) {
  const input = standbySchema.parse(raw);
  const q = await cargar(db, id, actor);
  if (sueltaLaFecha(q.status)) {
    throw new QuoteError(409, q.status === 'standby' ? 'El evento ya está en standby.' : 'El evento está cancelado.');
  }
  const quote = await db.quote.update({
    where: { id },
    data: { status: 'standby', statusPrevio: q.status, standbyDesde: new Date(), standbyMotivo: input.motivo },
    include: includeRels,
  });
  await logActivity(db, {
    quoteId: id,
    tipo: 'standby',
    descripcion: `En standby, sin fecha (tenía el ${q.fechaEvento.toISOString().slice(0, 10)}): ${input.motivo}`,
    meta: { de: q.status, fechaQueTenia: q.fechaEvento.toISOString().slice(0, 10), motivo: input.motivo },
    actorId: actor.id,
  });
  return quote;
}

/**
 * Le pone fecha nueva al evento. Si estaba en standby o cancelado, vuelve al
 * estatus que tenía (y de ahí sube si los pagos ya dan para más).
 */
export async function reprogramarEvento(db: PrismaClient, id: string, raw: unknown, actor: Actor) {
  const input = reprogramarSchema.parse(raw);
  const q = await cargar(db, id, actor);
  if (q.status === 'cancelada' && actor.role !== 'admin') {
    throw new QuoteError(403, 'Solo un admin puede reactivar un evento cancelado.');
  }
  const regresa = sueltaLaFecha(q.status);
  const destino: QuoteStatus = regresa ? (q.statusPrevio && CON_FECHA.has(q.statusPrevio) ? q.statusPrevio : 'borrador') : q.status;
  const fechaAntes = q.fechaEvento.toISOString().slice(0, 10);
  // El precio se respeta si se pidió, si ya está liquidado (no se recotiza lo que
  // ya se pagó completo) o si vino del BI con precio pactado.
  const conservar = input.conservarPrecio || destino === 'liquidada' || q.importadoBI != null;

  return enTransaccionConActor(
    async (txRaw) => {
      const tx = txRaw as unknown as PrismaClient;
      if (conservar) {
        await assertEspaciosDisponibles(tx, input.fecha, q.spaceIds, id);
        const datos = { fecha: input.fecha, cliente: q.client?.nombre ?? '', spaceIds: q.spaceIds };
        const codigo = await calcularCodigo(tx, datos, { id, etiqueta: q.etiqueta });
        await tx.quote.update({
          where: { id },
          data: {
            fechaEvento: new Date(`${input.fecha}T00:00:00.000Z`),
            status: destino,
            etiqueta: codigo,
            ...(codigo !== q.etiqueta
              ? {
                  codigos: {
                    create: renglonDeCodigo(
                      codigo,
                      datos,
                      motivosDelCambio({ ...datos, fecha: fechaAntes }, datos),
                      actor.id,
                    ),
                  },
                }
              : {}),
          },
        });
      } else {
        // Vuelve primero a su estatus con fecha, para que el camino normal de
        // mover (recalcula, revisa disponibilidad, mueve el código) lo acepte.
        // Si la fecha no está libre, la transacción revierte también esto.
        if (regresa) await tx.quote.update({ where: { id }, data: { status: destino } });
        await moveQuoteDate(tx, id, input.fecha, actor);
      }

      await tx.quote.update({
        where: { id },
        data: {
          ...(regresa ? { statusPrevio: null } : {}),
          standbyDesde: null,
          standbyMotivo: null,
          canceladaAt: null,
          cancelacionMotivo: null,
          cancelacionPct: null,
          cancelacionPagado: null,
          cancelacionDevolver: null,
        },
      });
      await logActivity(tx, {
        quoteId: id,
        tipo: 'reprogramada',
        descripcion:
          (q.status === 'standby'
            ? 'Sale de standby'
            : q.status === 'cancelada'
              ? 'Se reactiva el evento cancelado'
              : 'Se reprograma') +
          `: ${fechaAntes} → ${input.fecha}${conservar ? ' (respetando el precio pactado)' : ''}.`,
        meta: { de: q.status, a: destino, fechaAntes, fechaDespues: input.fecha, conservarPrecio: conservar },
        actorId: actor.id,
      });

      // Lo que se pagó mientras no tenía fecha puede ya dar para un estatus mayor.
      const actual = await tx.quote.findUniqueOrThrow({ where: { id } });
      const { estadoCuenta } = await loadEstadoCuenta(tx, actual);
      if (esUpgrade(actual.status, estadoCuenta.sugerido)) {
        await tx.quote.update({ where: { id }, data: { status: estadoCuenta.sugerido! } });
        await logActivity(tx, {
          quoteId: id,
          tipo: 'estatus',
          descripcion: `Estatus: ${actual.status} → ${estadoCuenta.sugerido} (por los pagos, al reprogramar)`,
          meta: { de: actual.status, a: estadoCuenta.sugerido, auto: true },
          actorId: actor.id,
        });
      }
      return tx.quote.findUniqueOrThrow({ where: { id }, include: includeRels });
    },
    db,
    { timeout: 20_000 },
  );
}

/**
 * La cancelación tal como se ve hoy: lo acordado, lo que ya se devolvió desde
 * que se canceló y lo que falta. `null` si el evento no está cancelado.
 */
export async function resumenCancelacion(
  db: PrismaClient,
  q: {
    id: string;
    status: string;
    canceladaAt: Date | null;
    cancelacionMotivo: string | null;
    cancelacionPct: number | null;
    cancelacionPagado: number | null;
    cancelacionDevolver: number | null;
  },
) {
  if (q.status !== 'cancelada' || !q.canceladaAt) return null;
  const devueltas = await db.devolucion.findMany({
    where: { quoteId: q.id, destino: 'evento', anuladoAt: null, createdAt: { gte: q.canceladaAt } },
    select: { monto: true },
  });
  const devuelto = devueltas.reduce((s, d) => s + d.monto, 0);
  const devolver = q.cancelacionDevolver ?? 0;
  const pagado = q.cancelacionPagado ?? 0;
  return {
    fecha: q.canceladaAt.toISOString(),
    motivo: q.cancelacionMotivo,
    porcentaje: q.cancelacionPct ?? 0,
    pagado,
    devolver,
    retenido: pagado - devolver,
    devuelto,
    pendiente: pendientePorDevolver(devolver, devuelto),
  };
}

/** Los eventos en standby: los que hoy no tienen fecha. */
export async function eventosSinFecha(db: PrismaClient, actor: Actor) {
  const quotes = await db.quote.findMany({
    where: { status: 'standby', deletedAt: null, ...ownershipWhere(actor) },
    include: { client: { select: { nombre: true } }, eventType: { select: { nombre: true } } },
    orderBy: { standbyDesde: 'asc' },
  });
  return quotes.map((q) => ({
    quoteId: q.id,
    codigo: q.etiqueta,
    folio: q.folio,
    cliente: q.client?.nombre ?? 'Cliente',
    eventoNombre: q.eventType?.nombre ?? 'Evento',
    fechaQueTenia: q.fechaEvento.toISOString(),
    spaceIds: q.spaceIds,
    standbyDesde: q.standbyDesde?.toISOString() ?? null,
    motivo: q.standbyMotivo,
    statusPrevio: q.statusPrevio,
  }));
}
