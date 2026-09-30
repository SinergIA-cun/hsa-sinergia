import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { PRODUCTOS_CARGO, PRODUCTO_INFO, formatFolio, type ProductoCargo } from '@hsa/shared';
import { cuentaDelEvento } from './cuenta.js';
import { QuoteError, ownershipWhere, assertNotTrashed, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';

/**
 * El punto de venta del evento: su cuenta de cargos.
 *
 * Lo que se vende DESPUÉS de contratar —horas extra, DJ extra, invitados de más,
 * multas, daños, gastos imprevistos— se carga aquí. Dos reglas del dueño:
 *
 *  1. **No aumenta el valor del evento.** `Quote.total`, `rentaTotal` y el plan
 *     de pagos quedan como se firmaron. Es una venta aparte, casada al evento.
 *  2. **Sus pagos se registran y se reportan al BI**, con folio de la serie I
 *     como cualquier otro dinero que entra (`Payment.destino = cargos`).
 */

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const cargoSchema = z.object({
  producto: z.enum(PRODUCTOS_CARGO),
  /** Enteros: dos horas, cinco invitados. Prisma truncaría un decimal. */
  cantidad: z.number().int().positive().max(10_000),
  /** Con IVA incluido. Cero se rechaza: un cargo de cero no es venta. */
  precioUnitario: z.number().int().positive(),
  descripcion: z.string().trim().max(200).optional(),
  fecha: fechaISO,
});

export { cuentaDelEvento, productosDelEvento } from './cuenta.js';

export const anularCargoSchema = z.object({ motivo: z.string().min(3) });

/** El evento, validado para recibir cargos. */
async function eventoParaCargos(db: PrismaClient, quoteId: string, actor: Actor) {
  const quote = await db.quote.findFirst({ where: { id: quoteId, ...ownershipWhere(actor) } });
  if (!quote) throw new QuoteError(404, 'Evento no encontrado');
  assertNotTrashed(quote);
  // Un borrador es una cotización, todavía no un evento: no tiene cuenta que
  // cargarle. Lo que se quiera vender antes de contratar va en la cotización.
  if (quote.status === 'borrador') {
    throw new QuoteError(409, 'Un borrador todavía no es un evento: formalízalo antes de cargarle algo a su cuenta.');
  }
  return quote;
}

export async function registrarCargo(db: PrismaClient, quoteId: string, rawInput: unknown, actor: Actor) {
  await eventoParaCargos(db, quoteId, actor);
  const input = cargoSchema.parse(rawInput);
  const info = PRODUCTO_INFO[input.producto as ProductoCargo];
  if (info.pideDescripcion && !input.descripcion) {
    throw new QuoteError(400, `Describe qué pasó: "${info.nombre}" sin descripción no se puede cobrar ni aclarar después.`);
  }
  const descripcion = input.descripcion || info.nombre;
  const total = input.cantidad * input.precioUnitario;
  const cargo = await db.cargoEvento.create({
    data: {
      quoteId,
      producto: input.producto,
      descripcion,
      cantidad: input.cantidad,
      precioUnitario: input.precioUnitario,
      total,
      fecha: new Date(`${input.fecha}T00:00:00.000Z`),
      registradoById: actor.id,
    },
  });
  await logActivity(db, {
    quoteId,
    tipo: 'cargo',
    descripcion: `Cargo a la cuenta: ${descripcion} · ${input.cantidad} × $${input.precioUnitario} = $${total}`,
    meta: { cargoId: cargo.id, producto: input.producto, cantidad: input.cantidad, precioUnitario: input.precioUnitario, total },
    actorId: actor.id,
  });
  return { cargo, cuenta: await cuentaDelEvento(db, quoteId) };
}

/**
 * Anula un renglón. Solo admin, igual que anular un pago: es mover dinero hacia
 * atrás. No deja la cuenta sobrepagada: si lo cobrado ya pasa de lo que quedaría,
 * primero se anula el pago.
 */
export async function anularCargo(
  db: PrismaClient,
  quoteId: string,
  cargoId: string,
  rawInput: unknown,
  actor: Actor,
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede anular un cargo.');
  const { motivo } = anularCargoSchema.parse(rawInput);
  const quote = await db.quote.findFirst({ where: { id: quoteId } });
  if (!quote) throw new QuoteError(404, 'Evento no encontrado');
  assertNotTrashed(quote);
  const cargo = await db.cargoEvento.findFirst({ where: { id: cargoId, quoteId } });
  if (!cargo) throw new QuoteError(404, 'Cargo no encontrado');
  if (cargo.anuladoAt) throw new QuoteError(409, 'Ese cargo ya está anulado.');

  const cuenta = await cuentaDelEvento(db, quoteId);
  if (cuenta.pagado > cuenta.total - cargo.total) {
    throw new QuoteError(
      409,
      `La cuenta ya tiene cobrados $${cuenta.pagado}; sin este cargo quedaría en $${cuenta.total - cargo.total}. Anula primero el pago.`,
    );
  }
  await db.cargoEvento.update({
    where: { id: cargoId },
    data: { anuladoAt: new Date(), anuladoById: actor.id, motivoAnulacion: motivo },
  });
  await logActivity(db, {
    quoteId,
    tipo: 'cargoAnulado',
    descripcion: `Cargo anulado: ${cargo.descripcion} $${cargo.total}: ${motivo}`,
    meta: { cargoId, total: cargo.total, motivo },
    actorId: actor.id,
  });
  return cuentaDelEvento(db, quoteId);
}

/**
 * Valida un cobro a la cuenta ANTES de registrarlo: que el evento pueda tener
 * cuenta y que no se cobre más de lo que se debe. Lo llama `registerPayment`.
 */
export async function validarCobroDeCargos(db: PrismaClient, quote: { id: string; status: string }, monto: number) {
  if (quote.status === 'borrador') {
    throw new QuoteError(409, 'Un borrador todavía no es un evento: no tiene cuenta que cobrar.');
  }
  const { saldo } = await cuentaDelEvento(db, quote.id);
  if (monto > saldo) {
    throw new QuoteError(
      409,
      saldo <= 0
        ? 'La cuenta del evento no tiene nada pendiente: carga primero lo que se va a cobrar.'
        : `La cuenta del evento debe $${saldo}; no se le pueden cobrar $${monto}.`,
    );
  }
}

/** Texto del pago a la cuenta para la bitácora. */
export function descripcionPagoCargos(folio: number, monto: number, formas: string) {
  return `Pago ${formatFolio(folio)} a la cuenta del evento $${monto} (${formas})`;
}
