import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { estadoFacturaPago, hoyCivilMexico } from '@hsa/shared';
import { QuoteError, ownershipWhere, loadEstadoCuenta, assertNotTrashed, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import { esUpgrade, type PaymentStatus } from '../quotes/estadoCuenta.js';
import type { ComprobanteStorage } from './storage.js';

export const registerPaymentSchema = z.object({
  monto: z.number().int().positive(),
  metodo: z.enum(['efectivo', 'transferencia', 'tarjeta']),
  concepto: z.enum(['anticipo', 'complemento', 'aCuenta', 'finiquito']),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referencia: z.string().optional(),
});

export const anularSchema = z.object({ motivo: z.string().min(3) });

async function findOwnedQuote(db: PrismaClient, id: string, actor: Actor) {
  const quote = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(quote);
  return quote;
}

export async function registerPayment(
  db: PrismaClient,
  storage: ComprobanteStorage,
  quoteId: string,
  rawInput: unknown,
  actor: Actor,
  file?: { data: Buffer; mime: string },
) {
  const quote = await findOwnedQuote(db, quoteId, actor);
  const input = registerPaymentSchema.parse(rawInput);

  let comprobanteKey: string | null = null;
  let comprobanteMime: string | null = null;
  if (file) {
    const stored = await storage.save(file.data, file.mime);
    comprobanteKey = stored.key;
    comprobanteMime = stored.mime;
  }

  const payment = await db.payment.create({
    data: {
      quoteId,
      monto: input.monto,
      metodo: input.metodo,
      concepto: input.concepto,
      fecha: new Date(`${input.fecha}T00:00:00.000Z`),
      referencia: input.referencia ?? null,
      comprobanteKey,
      comprobanteMime,
      registradoById: actor.id,
    },
  });

  await logActivity(db, {
    quoteId, tipo: 'pago',
    descripcion: `Pago ${input.concepto} $${input.monto} (${input.metodo})`,
    meta: { paymentId: payment.id, monto: input.monto, concepto: input.concepto }, actorId: actor.id,
  });

  let { estadoCuenta } = await loadEstadoCuenta(db, quote);

  // Auto-avance de estatus: si el acumulado cruza un hito, el estatus sube solo
  // (nunca baja). No requiere confirmación manual.
  let nuevoEstatus: PaymentStatus | null = null;
  if (esUpgrade(quote.status, estadoCuenta.sugerido)) {
    nuevoEstatus = estadoCuenta.sugerido!;
    await db.quote.update({ where: { id: quoteId }, data: { status: nuevoEstatus } });
    await logActivity(db, {
      quoteId, tipo: 'estatus',
      descripcion: `Estatus: ${quote.status} → ${nuevoEstatus} (automático por pago)`,
      meta: { de: quote.status, a: nuevoEstatus, auto: true }, actorId: actor.id,
    });
    // Recalcular con el nuevo estatus para que 'desfase' quede coherente.
    ({ estadoCuenta } = await loadEstadoCuenta(db, { ...quote, status: nuevoEstatus }));
  }

  return { payment, estadoCuenta, nuevoEstatus };
}

export async function anularPayment(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  motivo: string,
  actor: Actor,
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede anular pagos');
  const quote = await findOwnedQuote(db, quoteId, actor);
  const payment = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!payment) throw new QuoteError(404, 'Pago no encontrado');
  if (payment.anuladoAt) throw new QuoteError(409, 'El pago ya está anulado');

  await db.payment.update({
    where: { id: paymentId },
    data: { anuladoAt: new Date(), anuladoById: actor.id, motivoAnulacion: motivo },
  });
  await logActivity(db, {
    quoteId, tipo: 'pagoAnulado',
    descripcion: `Pago anulado $${payment.monto}: ${motivo}`,
    meta: { paymentId, motivo }, actorId: actor.id,
  });

  const { estadoCuenta } = await loadEstadoCuenta(db, quote);
  return { estadoCuenta };
}

/**
 * Reabre la facturación de un pago cuyo mes ya cerró. Solo admin.
 *
 * Existe porque los CFDI se cancelan y se reemiten: sin esta salida habría que
 * crear un cliente nuevo para corregir un RFC mal capturado. No reabre un pago
 * que YA se facturó — para eso primero hay que cancelar el CFDI.
 */
export async function desbloquearFactura(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  actor: Actor,
) {
  if (actor.role !== 'admin') {
    throw new QuoteError(403, 'Solo un admin puede desbloquear la facturación de un pago.');
  }
  const pago = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!pago) throw new QuoteError(404, 'Pago no encontrado');
  if (pago.facturadoAt) {
    throw new QuoteError(409, 'Este pago ya tiene CFDI. Cancélalo antes de reabrirlo.');
  }
  const actualizado = await db.payment.update({
    where: { id: paymentId },
    data: { desbloqueoAt: new Date() },
  });
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Desbloqueo de facturación del pago folio ${pago.folio}`,
    meta: { paymentId, folio: pago.folio },
    actorId: actor.id,
  });
  const est = estadoFacturaPago(actualizado, hoyCivilMexico());
  return { payment: actualizado, facturable: est.facturable };
}

export interface ComprobanteData {
  data: Buffer;
  mime: string;
}

/** Comprobante de un pago para la vendedora/admin (respeta ownership). */
export async function loadComprobanteInterno(
  db: PrismaClient,
  storage: ComprobanteStorage,
  quoteId: string,
  paymentId: string,
  actor: Actor,
): Promise<ComprobanteData | null> {
  const quote = await db.quote.findFirst({ where: { id: quoteId, ...ownershipWhere(actor) }, select: { id: true } });
  if (!quote) return null;
  const payment = await db.payment.findFirst({
    where: { id: paymentId, quoteId },
    select: { comprobanteKey: true, comprobanteMime: true },
  });
  if (!payment?.comprobanteKey) return null;
  const data = await storage.load(payment.comprobanteKey);
  if (!data) return null;
  return { data, mime: payment.comprobanteMime ?? 'application/octet-stream' };
}

/** Comprobante para el cliente vía token público (valida pertenencia y no anulado). */
export async function loadComprobantePublico(
  db: PrismaClient,
  storage: ComprobanteStorage,
  token: string,
  paymentId: string,
): Promise<ComprobanteData | null> {
  const quote = await db.quote.findUnique({ where: { publicToken: token }, select: { id: true } });
  if (!quote) return null;
  const payment = await db.payment.findFirst({
    where: { id: paymentId, quoteId: quote.id, anuladoAt: null },
    select: { comprobanteKey: true, comprobanteMime: true },
  });
  if (!payment?.comprobanteKey) return null;
  const data = await storage.load(payment.comprobanteKey);
  if (!data) return null;
  return { data, mime: payment.comprobanteMime ?? 'application/octet-stream' };
}
