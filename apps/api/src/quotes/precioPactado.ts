import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import { conPrecioPactado, type QuoteBreakdown } from '@hsa/shared';
import { QuoteError, ownershipWhere, assertNotTrashed, loadEstadoCuenta, type Actor } from './service.js';
import { logActivity } from './activityLog.js';
import { ponerAlDia } from '../payments/estatus.js';

// Un evento con precio pactado (importado del BI, o apartado con renta acordada)
// no se recotiza ni se edita desde el formulario. Pero el contrato sí cambia
// después de venderlo ("el valor del contrato subió", 13-oct-2026): esto lo
// ajusta un admin, con motivo, y queda en la bitácora.

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-MX')}`;

export const ajustarPrecioSchema = z.object({
  /** La renta del salón, con IVA. */
  renta: z.number().int().nonnegative(),
  /** Alimentos y servicios pactados, con IVA. Solo eventos del BI; sin él no se tocan. */
  otros: z.number().int().nonnegative().optional(),
  motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 letras).').max(300),
});

export async function ajustarPrecioPactado(db: PrismaClient, quoteId: string, rawInput: unknown, actor: Actor) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede ajustar el precio de un evento.');
  const input = ajustarPrecioSchema.parse(rawInput);
  const quote = await db.quote.findFirst({ where: { id: quoteId, ...ownershipWhere(actor) } });
  if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(quote);
  if (!quote.precioPactado) throw new QuoteError(409, 'Este evento se cotiza con el catálogo: cambia su precio editándolo.');
  if (quote.status === 'cancelada') throw new QuoteError(409, 'El evento está cancelado.');

  const antes = quote.breakdown as unknown as QuoteBreakdown;
  const lista = await db.priceList.findUnique({ where: { id: quote.priceListId }, select: { ivaRate: true } });
  let nuevo: QuoteBreakdown;
  try {
    nuevo = conPrecioPactado(antes, { renta: input.renta, otros: input.otros }, lista?.ivaRate ?? 0.16);
  } catch (e) {
    throw new QuoteError(409, e instanceof Error ? e.message : String(e));
  }
  const total = Math.round(nuevo.total);
  const rentaTotal = Math.round(nuevo.rentaTotal);
  if (total === quote.total && rentaTotal === quote.rentaTotal) throw new QuoteError(400, 'El precio es el mismo: no hay nada que ajustar.');

  // Lo pagado va contra la renta: no puede quedar por encima de ella.
  const { estadoCuenta } = await loadEstadoCuenta(db, quote);
  if (estadoCuenta.pagado > rentaTotal) {
    throw new QuoteError(
      409,
      `El evento ya tiene pagados ${pesos(estadoCuenta.pagado)}; la renta no puede quedar en ${pesos(rentaTotal)}. Corrige o mueve un pago primero.`,
    );
  }

  await db.quote.update({
    where: { id: quoteId },
    data: { breakdown: nuevo as unknown as Prisma.InputJsonValue, total, rentaTotal },
  });
  const otrosAntes = Math.round(antes.otrosTotal ?? 0);
  const otrosDespues = Math.round(nuevo.otrosTotal ?? 0);
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion:
      `Precio pactado ajustado: total ${pesos(quote.total)} → ${pesos(total)}` +
      ` (renta ${pesos(quote.rentaTotal)} → ${pesos(rentaTotal)}` +
      (otrosAntes !== otrosDespues ? `, alimentos y servicios ${pesos(otrosAntes)} → ${pesos(otrosDespues)}` : '') +
      `). Motivo: ${input.motivo}`,
    meta: { antes: { total: quote.total, rentaTotal: quote.rentaTotal, otrosTotal: otrosAntes }, despues: { total, rentaTotal, otrosTotal: otrosDespues }, motivo: input.motivo },
    actorId: actor.id,
  });
  // El saldo cambió: el estatus y la foto del histórico se ponen al día.
  await ponerAlDia(db, quoteId, actor.id, 'ajuste de precio');
  return { total, rentaTotal, otrosTotal: otrosDespues };
}
