import type { PaymentConcept, PrismaClient } from '@hsa/database';
import { restarDinero, sumarDinero } from '@hsa/shared';

/*
 * La cuenta del BANQUETE (Jorge, 15-oct-2026: "Registrar Pago Banquete").
 *
 * Decisión de Fernando: ese dinero lo cobra la hacienda. Es su propia cuenta,
 * como la del punto de venta: lleva folio I y recibo, pero NO toca la renta, el
 * plan de pagos ni el estatus del evento (todo eso lee `destino: 'evento'`).
 *
 * Lo que se cobra es el bloque "Alimentos y otros servicios" del contrato: el
 * total del evento menos su renta.
 *
 * Módulo hoja (solo Prisma y shared): lo importa `quotes/service.ts` sin ciclos.
 */

/** La cuenta del banquete de un evento: su total, lo pagado y sus pagos. */
export async function cuentaBanquete(db: PrismaClient, quote: { id: string; total: number; rentaTotal: number }) {
  const pagos = await db.payment.findMany({
    where: { quoteId: quote.id, destino: 'banquete' },
    orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
  });
  const total = Math.max(0, restarDinero(quote.total, quote.rentaTotal));
  const pagado = pagos.filter((p) => p.anuladoAt == null).reduce((s, p) => sumarDinero(s, p.monto), 0);
  return { total, pagado, saldo: restarDinero(total, pagado), pagos };
}

/**
 * El concepto de un pago del banquete, deducido como en la renta pero sin plan:
 * el que lo completa es finiquito; el primero, anticipo; los demás, a cuenta.
 */
export function conceptoDeBanquete(cuenta: { total: number; pagado: number }, monto: number): PaymentConcept {
  if (sumarDinero(cuenta.pagado, monto) >= cuenta.total) return 'finiquito';
  return cuenta.pagado === 0 ? 'anticipo' : 'aCuenta';
}

