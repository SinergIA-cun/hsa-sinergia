import type { PrismaClient, Prisma } from '@hsa/database';
import { deducirConceptos, type PaymentConcept } from '@hsa/shared';
import { loadEstadoCuenta, type QuoteEC } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import type { Milestone } from '../quotes/estadoCuenta.js';

/**
 * Lo que vale el contrato para la deducción: la renta completa (el objetivo del
 * finiquito del plan, o `rentaTotal` si el espacio no tiene plan). Es lo que se
 * paga a la hacienda; los alimentos de "otros" van al proveedor.
 */
export function totalDelContrato(plan: Milestone[] | null, rentaTotal: number): number | null {
  const finiquito = plan?.find((m) => m.key === 'finiquito')?.objetivo;
  const total = finiquito ?? rentaTotal;
  return total > 0 ? total : null;
}

export interface CambioConcepto {
  paymentId: string;
  folio: number;
  de: PaymentConcept;
  a: PaymentConcept;
}

/**
 * Recalcula el concepto EFECTIVO de todos los pagos de una cotización y persiste
 * los que cambiaron.
 *
 * Por qué de todos y no solo del que se acaba de tocar: el concepto de un pago
 * depende de lo que había pagado ANTES de él, así que anular (o corregir) un pago
 * mueve el acumulado y puede cambiar el concepto de todos los POSTERIORES. El
 * caso que lo hace obvio: tres pagos, se anula el segundo, y el tercero deja de
 * ser el finiquito porque ya no cierra la cuenta.
 *
 * El orden importa y es parte del resultado: fecha, y `createdAt` para desempatar
 * dos pagos del mismo día. `loadEstadoCuenta` ya ordena por fecha; el desempate
 * se agrega aquí para que la deducción sea determinista.
 *
 * `salvo` es el pago que el llamador acaba de crear o corregir: su cambio no se
 * anota en la bitácora porque ya lo anota él, con más contexto. Lo que sí se
 * anota es la reclasificación EN CADENA de los demás, que es la que nadie pidió
 * y por eso hay que poder auditar.
 */
export async function reclasificarConceptos(
  db: PrismaClient,
  quote: QuoteEC,
  opts: { actorId?: string; salvo?: string } = {},
) {
  const { estadoCuenta, payments } = await loadEstadoCuenta(db, quote);

  const ordenados = [...payments].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const efectivos = deducirConceptos(ordenados, totalDelContrato(estadoCuenta.plan, quote.rentaTotal));

  const cambios: CambioConcepto[] = [];
  for (const p of ordenados) {
    const nuevo = efectivos.get(p.id);
    if (nuevo == null || nuevo === p.concepto) continue;
    cambios.push({ paymentId: p.id, folio: p.folio, de: p.concepto, a: nuevo });
    await db.payment.update({ where: { id: p.id }, data: { concepto: nuevo } });
  }

  const enCadena = cambios.filter((c) => c.paymentId !== opts.salvo);
  if (enCadena.length > 0) {
    await logActivity(db, {
      quoteId: quote.id,
      tipo: 'edicion',
      descripcion: `Conceptos reclasificados por el saldo: ${enCadena
        .map((c) => `folio ${c.folio} ${c.de} → ${c.a}`)
        .join(' · ')}`,
      meta: { cambios: enCadena as unknown as Prisma.InputJsonValue },
      actorId: opts.actorId,
    });
  }

  // Los pagos que se devuelven ya traen el concepto nuevo: quien los imprima (el
  // panel, el recibo) no debe ver el viejo por un instante.
  const actualizados = payments.map((p) => ({ ...p, concepto: efectivos.get(p.id) ?? p.concepto }));
  return { estadoCuenta, payments: actualizados, cambios };
}
