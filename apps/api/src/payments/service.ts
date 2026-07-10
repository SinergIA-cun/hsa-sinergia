import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { QuoteError, ownershipWhere, loadEstadoCuenta, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import { esUpgrade } from '../quotes/estadoCuenta.js';
import type { ComprobanteStorage } from './storage.js';

export const registerPaymentSchema = z.object({
  monto: z.number().int().positive(),
  metodo: z.enum(['efectivo', 'transferencia', 'tarjeta']),
  concepto: z.enum(['anticipo', 'complemento', 'aCuenta', 'finiquito']),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referencia: z.string().optional(),
  comprobanteUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'La URL debe ser http o https')
    .optional(),
});

export const anularSchema = z.object({ motivo: z.string().min(3) });

async function findOwnedQuote(db: PrismaClient, id: string, actor: Actor) {
  const quote = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
  return quote;
}

export async function registerPayment(
  db: PrismaClient,
  storage: ComprobanteStorage,
  quoteId: string,
  rawInput: unknown,
  actor: Actor,
  file?: { data: Buffer; contentType: string },
) {
  const quote = await findOwnedQuote(db, quoteId, actor);
  const input = registerPaymentSchema.parse(rawInput);

  let comprobanteUrl = input.comprobanteUrl ?? null;
  let comprobantePendiente = false;
  if (file) {
    const r = await storage.upload(file.data, file.contentType);
    comprobanteUrl = r.url;
    comprobantePendiente = r.pendiente;
  }

  const payment = await db.payment.create({
    data: {
      quoteId,
      monto: input.monto,
      metodo: input.metodo,
      concepto: input.concepto,
      fecha: new Date(`${input.fecha}T00:00:00.000Z`),
      referencia: input.referencia ?? null,
      comprobanteUrl,
      comprobantePendiente,
      registradoById: actor.id,
    },
  });

  await logActivity(db, {
    quoteId, tipo: 'pago',
    descripcion: `Pago ${input.concepto} $${input.monto} (${input.metodo})`,
    meta: { paymentId: payment.id, monto: input.monto, concepto: input.concepto }, actorId: actor.id,
  });

  const { estadoCuenta } = await loadEstadoCuenta(db, quote);
  const sugerenciaUpgrade = esUpgrade(quote.status, estadoCuenta.sugerido) ? estadoCuenta.sugerido : null;
  return { payment, estadoCuenta, sugerenciaUpgrade };
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
