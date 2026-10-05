import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { PRODUCTOS_CARGO, PRODUCTO_INFO, afectaContrato, formatFolio, type ProductoCargo } from '@hsa/shared';
import { cuentaDelEvento } from './cuenta.js';
import { sincronizarContrato } from './contrato.js';
import { QuoteError, ownershipWhere, assertNotTrashed, loadEstadoCuenta, type Actor } from '../quotes/service.js';
import { esUpgrade } from '../quotes/estadoCuenta.js';
import { reclasificarConceptos } from '../payments/conceptos.js';
import { logActivity } from '../quotes/activityLog.js';
import { archivarEvento } from '../historico/archivar.js';

/**
 * El punto de venta del evento: su cuenta de cargos.
 *
 * Lo que se vende DESPUÉS de contratar —horas extra, DJ extra, invitados de más,
 * multas, daños, gastos imprevistos— se carga aquí. Dos reglas del dueño:
 *
 *  1. **Horas extra de salón y PAX extra SUBEN el contrato** (5-oct-2026: "debe
 *     reflejarse en ambos lados, punto de venta y BI"). Se suman al desglose,
 *     suben `total` y `rentaTotal`, y se cobran con pagos normales del evento:
 *     el evento no queda liquidado hasta cubrirlos. Ver `contrato.ts`.
 *  2. **Lo demás va a la cuenta aparte** (multas, daños, DJ, alimentos, PAX
 *     banquete): no cambia el valor del evento y sus pagos van con
 *     `Payment.destino = cargos`, con folio de la serie I.
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

/**
 * Después de sumar o quitar un cargo del contrato: el desglose y el total al día,
 * las etiquetas de los pagos (el finiquito puede moverse) y el estatus. Un evento
 * liquidado al que se le suman horas extra REGRESA al estatus que dicen sus pagos:
 * ya no está liquidado hasta cubrirlas. Y al anularlas puede volver a subir.
 */
async function alContrato(db: PrismaClient, quoteId: string, actorId: string, que: string) {
  const { antes, despues } = await sincronizarContrato(db, quoteId);
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Contrato: ${que} · total ${antes} → ${despues}`,
    meta: { totalAntes: antes, totalDespues: despues, origen: 'puntoDeVenta' },
    actorId,
  });
  const quote = await db.quote.findUniqueOrThrow({ where: { id: quoteId } });
  await reclasificarConceptos(db, quote, { actorId });
  const { estadoCuenta } = await loadEstadoCuenta(db, quote);
  const sugerido = estadoCuenta.sugerido;
  let nuevo: string | null = null;
  if (quote.status === 'liquidada' && sugerido && sugerido !== 'liquidada') nuevo = sugerido;
  else if (esUpgrade(quote.status, sugerido)) nuevo = sugerido;
  if (nuevo && nuevo !== quote.status) {
    await db.quote.update({ where: { id: quoteId }, data: { status: nuevo as typeof quote.status } });
    await logActivity(db, {
      quoteId,
      tipo: 'estatus',
      descripcion: `Estatus: ${quote.status} → ${nuevo} (automático: cambió el valor del contrato)`,
      meta: { de: quote.status, a: nuevo, auto: true },
      actorId,
    });
  }
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
  if (afectaContrato(input.producto as ProductoCargo)) await alContrato(db, quoteId, actor.id, `+${descripcion} $${total}`);
  // A un evento que ya pasó se le cargan las horas extra o la multa después: su
  // foto del Histórico se pone al día (no hace nada si todavía no se celebra).
  await archivarEvento(db, quoteId);
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

  if (afectaContrato(cargo.producto)) {
    // Sube el contrato: sin él, el evento no puede quedar con más pagado que su valor.
    const { estadoCuenta } = await loadEstadoCuenta(db, quote);
    if (estadoCuenta.pagado > quote.rentaTotal - cargo.total) {
      throw new QuoteError(
        409,
        `El evento ya tiene pagados $${estadoCuenta.pagado}; sin este cargo su renta quedaría en $${quote.rentaTotal - cargo.total}. Anula primero un pago.`,
      );
    }
  } else {
    const cuenta = await cuentaDelEvento(db, quoteId);
    if (cuenta.pagado > cuenta.total - cargo.total) {
      throw new QuoteError(
        409,
        `La cuenta ya tiene cobrados $${cuenta.pagado}; sin este cargo quedaría en $${cuenta.total - cargo.total}. Anula primero el pago.`,
      );
    }
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
  if (afectaContrato(cargo.producto)) await alContrato(db, quoteId, actor.id, `−${cargo.descripcion} $${cargo.total} (anulado)`);
  await archivarEvento(db, quoteId);
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
