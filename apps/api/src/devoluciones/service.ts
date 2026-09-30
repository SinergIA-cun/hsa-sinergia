import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { formasPagoSchema, metodoCapturaSchema, describirFormasPago, hoyCivilMexico } from '@hsa/shared';
import { QuoteError, assertNotTrashed, loadEstadoCuenta, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import { resolverOError } from '../payments/service.js';
import { cuentaDelEvento } from '../cargos/cuenta.js';
import { archivarEvento } from '../historico/archivar.js';
import { cargarDeposito, saldoDeDeposito, saldoLiberadoPorApartados } from '../banqueteros/cuenta.js';

/**
 * Devoluciones: "si un cliente pagó un monto de más, poder devolverle y que se
 * marque" (el dueño).
 *
 * Todo aquí es de ADMIN: es dinero que sale de la hacienda, igual que anular un
 * pago. Y nada se borra: una devolución equivocada se anula, con motivo.
 *
 * El tope es lo que efectivamente entró de ese lado. Devolver más sería regalar
 * dinero; el sistema no lo deja y lo dice con el número.
 */

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseSchema = z.object({
  monto: z.number().int().positive(),
  /** Cómo salió el dinero: una forma, o varias (una parte en efectivo y otra por transferencia). */
  metodo: metodoCapturaSchema.optional(),
  formas: formasPagoSchema.optional(),
  fecha: fechaISO,
  motivo: z.string().trim().min(3).max(300),
  referencia: z.string().max(120).optional(),
  /** El UUID de la nota de crédito (CFDI de egreso), si el pago ya estaba facturado. */
  notaCreditoUuid: z.string().uuid().nullish(),
});

export const devolucionEventoSchema = baseSchema.extend({
  /** De qué se devuelve: la renta del evento o su cuenta del punto de venta. */
  destino: z.enum(['evento', 'cargos']).default('evento'),
});

export const devolucionBanqueteroSchema = baseSchema.extend({
  /** El depósito de cuyo saldo sin repartir sale. Sin él, sale del saldo liberado por apartados. */
  pagoBanqueteroId: z.string().min(1).nullish(),
});

export const anularDevolucionSchema = z.object({ motivo: z.string().min(3) });
export const notaCreditoSchema = z.object({ notaCreditoUuid: z.string().uuid() });

function soloAdmin(actor: Actor) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede registrar o anular devoluciones.');
}

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const pesos = (n: number) => `$${n.toLocaleString('es-MX')}`;

/** Devolverle al cliente de un evento, de la renta o de la cuenta del punto de venta. */
export async function devolverACliente(db: PrismaClient, quoteId: string, raw: unknown, actor: Actor) {
  soloAdmin(actor);
  const input = devolucionEventoSchema.parse(raw);
  const forma = resolverOError(input);
  const quote = await db.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new QuoteError(404, 'Evento no encontrado');
  assertNotTrashed(quote);

  // Lo pagado NETO de ese lado (ya descuenta devoluciones anteriores): es el tope.
  const pagado =
    input.destino === 'cargos'
      ? (await cuentaDelEvento(db, quoteId)).pagado
      : (await loadEstadoCuenta(db, quote)).estadoCuenta.pagado;
  if (input.monto > pagado) {
    throw new QuoteError(
      409,
      `Solo se han recibido ${pesos(pagado)} ${input.destino === 'cargos' ? 'en la cuenta del evento' : 'de la renta'}: no se pueden devolver ${pesos(input.monto)}.`,
    );
  }

  const dev = await db.devolucion.create({
    data: {
      quoteId,
      destino: input.destino,
      monto: input.monto,
      metodo: forma.metodo,
      formas: forma.formas ?? undefined,
      fecha: dia(input.fecha),
      motivo: input.motivo,
      referencia: input.referencia ?? null,
      notaCreditoUuid: input.notaCreditoUuid ?? null,
      registradoById: actor.id,
    },
  });
  await logActivity(db, {
    quoteId,
    tipo: 'devolucion',
    descripcion:
      `Devolución ${pesos(input.monto)} ${input.destino === 'cargos' ? 'de la cuenta del evento' : 'de la renta'}` +
      ` (${describirFormasPago(dev)}): ${input.motivo}`,
    meta: { devolucionId: dev.id, monto: input.monto, destino: input.destino, notaCreditoUuid: dev.notaCreditoUuid },
    actorId: actor.id,
  });
  await archivarEvento(db, quoteId);
  return dev;
}

/** Lo que al banquetero se le puede devolver de un depósito o del saldo liberado. */
async function disponibleBanquetero(db: PrismaClient, banqueteroId: string, pagoBanqueteroId: string | null) {
  if (pagoBanqueteroId) {
    const dep = await cargarDeposito(db, pagoBanqueteroId);
    if (dep.banqueteroId !== banqueteroId) throw new QuoteError(409, 'Ese depósito no es de este banquetero.');
    if (dep.anuladoAt) throw new QuoteError(409, 'Ese depósito está anulado.');
    return saldoDeDeposito(dep);
  }
  const [apartados, devueltas] = await Promise.all([
    db.apartadoFecha.findMany({
      where: { banqueteroId },
      select: {
        canceladoAt: true,
        quoteId: true,
        vence: true,
        abonos: { select: { monto: true, anuladoAt: true, paymentId: true, pagoBanqueteroId: true } },
      },
    }),
    db.devolucion.aggregate({
      where: { banqueteroId, pagoBanqueteroId: null, anuladoAt: null },
      _sum: { monto: true },
    }),
  ]);
  return saldoLiberadoPorApartados(apartados, hoyCivilMexico()) - (devueltas._sum.monto ?? 0);
}

/**
 * Devolverle al banquetero su saldo a favor.
 *
 * Sale de un depósito concreto (su saldo sin repartir) o del saldo que le
 * liberaron sus apartados vencidos o cancelados. Hay que decir de cuál porque es
 * dinero distinto: el primero entró como depósito a cuenta; el segundo, como
 * abono a una fecha que ya no tiene.
 */
export async function devolverABanquetero(db: PrismaClient, banqueteroId: string, raw: unknown, actor: Actor) {
  soloAdmin(actor);
  const input = devolucionBanqueteroSchema.parse(raw);
  const forma = resolverOError(input);
  const b = await db.banquetero.findUnique({ where: { id: banqueteroId }, select: { id: true } });
  if (!b) throw new QuoteError(404, 'Banquetero no encontrado');
  const disponible = await disponibleBanquetero(db, banqueteroId, input.pagoBanqueteroId ?? null);
  if (input.monto > disponible) {
    throw new QuoteError(
      409,
      `${input.pagoBanqueteroId ? 'Ese depósito tiene sin repartir' : 'El saldo liberado por apartados es de'} ${pesos(Math.max(0, disponible))}: no se pueden devolver ${pesos(input.monto)}.`,
    );
  }
  return db.devolucion.create({
    data: {
      banqueteroId,
      pagoBanqueteroId: input.pagoBanqueteroId ?? null,
      monto: input.monto,
      metodo: forma.metodo,
      formas: forma.formas ?? undefined,
      fecha: dia(input.fecha),
      motivo: input.motivo,
      referencia: input.referencia ?? null,
      notaCreditoUuid: input.notaCreditoUuid ?? null,
      registradoById: actor.id,
    },
  });
}

export async function anularDevolucion(db: PrismaClient, devolucionId: string, raw: unknown, actor: Actor) {
  soloAdmin(actor);
  const { motivo } = anularDevolucionSchema.parse(raw);
  const dev = await db.devolucion.findUnique({ where: { id: devolucionId } });
  if (!dev) throw new QuoteError(404, 'Devolución no encontrada');
  if (dev.anuladoAt) throw new QuoteError(409, 'Esa devolución ya está anulada.');
  const anulada = await db.devolucion.update({
    where: { id: devolucionId },
    data: { anuladoAt: new Date(), anuladoById: actor.id, motivoAnulacion: motivo },
  });
  if (dev.quoteId) {
    await logActivity(db, {
      quoteId: dev.quoteId,
      tipo: 'devolucionAnulada',
      descripcion: `Devolución de ${pesos(dev.monto)} anulada: ${motivo}`,
      meta: { devolucionId, motivo },
      actorId: actor.id,
    });
    await archivarEvento(db, dev.quoteId);
  }
  return anulada;
}

/** Anotar después la nota de crédito, que a veces se timbra días más tarde. */
export async function anotarNotaCredito(db: PrismaClient, devolucionId: string, raw: unknown, actor: Actor) {
  soloAdmin(actor);
  const { notaCreditoUuid } = notaCreditoSchema.parse(raw);
  const dev = await db.devolucion.findUnique({ where: { id: devolucionId } });
  if (!dev) throw new QuoteError(404, 'Devolución no encontrada');
  if (dev.anuladoAt) throw new QuoteError(409, 'Esa devolución está anulada.');
  return db.devolucion.update({ where: { id: devolucionId }, data: { notaCreditoUuid } });
}
