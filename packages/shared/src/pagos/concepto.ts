import { z } from 'zod';

/**
 * Concepto de un pago: `anticipo`, `aCuenta` o `finiquito`. `complemento` sigue
 * en la lista solo porque existe en el enum de Postgres y en pagos viejos; desde
 * el 5-oct-2026 ya no se deduce (las etiquetas son las del BI).
 *
 * Es el mismo juego de valores que el enum `PaymentConcept` de Postgres; vive
 * aquí para que la deducción sea una función pura, sin Prisma de por medio.
 */
export const paymentConceptSchema = z.enum(['anticipo', 'complemento', 'aCuenta', 'finiquito']);
export type PaymentConcept = z.infer<typeof paymentConceptSchema>;

/**
 * Lo que debe quedar por pagar para que el pago que lo deja ahí sea el
 * finiquito: la misma tolerancia que usa el BI, para que los dos lados digan lo
 * mismo ("se completa el contrato con tolerancia de $1,000").
 */
export const TOLERANCIA_FINIQUITO = 1_000;

/** Lo que la deducción necesita saber de un pago. */
export interface PagoParaConcepto {
  id: string;
  monto: number;
  /** Un pago anulado no suma al acumulado: para el contrato, no existió. */
  anuladoAt: Date | null;
  /** El concepto que alguien capturó o corrigió a mano. `null` = nadie discrepó. */
  conceptoManual?: PaymentConcept | null;
  /** El concepto que hoy está guardado. Es el que se respeta cuando no hay precio. */
  concepto: PaymentConcept;
}

/**
 * El concepto de UN pago, con la regla del BI (decisión del dueño, 5-oct-2026:
 * "las mismas etiquetas que el BI, sin complemento").
 *
 * - `finiquito`: el pago con el que se completa el contrato, con tolerancia de
 *   $1,000. Es el que deja lo que se debe en $1,000 o menos por primera vez.
 *   Un solo pago que cubre todo es finiquito, no anticipo.
 * - `anticipo`: el primer pago, si no es el finiquito.
 * - `aCuenta`: todos los demás, incluidos los que llegan después del finiquito.
 *
 * `antes` es lo pagado (vivo) antes de este pago; `esPrimero` dice si es el
 * primer pago vivo del evento.
 */
export function deducirConcepto(antes: number, monto: number, total: number, esPrimero: boolean): PaymentConcept {
  const meta = total - TOLERANCIA_FINIQUITO;
  if (antes < meta && antes + monto >= meta) return 'finiquito';
  // Un contrato de $1,000 o menos: el primer pago ya lo completa.
  if (meta <= 0 && esPrimero) return 'finiquito';
  return esPrimero ? 'anticipo' : 'aCuenta';
}

/**
 * El concepto EFECTIVO de cada pago.
 *
 * `pagos` tiene que venir en el orden en que se aplicaron (fecha, y `createdAt`
 * para desempatar el mismo día): el concepto depende de lo pagado antes.
 *
 * `total` es lo que vale el contrato (la renta, más lo que el punto de venta le
 * haya sumado). `null` o `0` = un evento sin precio: no hay finiquito ni nada que
 * deducir, y se respeta lo capturado.
 *
 * - **El finiquito lo dicta el saldo**, en los dos sentidos: el pago que completa
 *   el contrato es finiquito aunque lo hayan capturado como otra cosa, y uno
 *   marcado "finiquito" a mano que no lo completa no lo es.
 * - Un ajuste a mano se respeta en los que no son finiquito.
 * - Los pagos anulados conservan el concepto con el que quedaron: son evidencia,
 *   no suman y no se reescriben.
 * - `complemento` ya no se deduce: queda solo en pagos viejos hasta que se
 *   reclasifican.
 */
export function deducirConceptos(pagos: PagoParaConcepto[], total: number | null): Map<string, PaymentConcept> {
  const out = new Map<string, PaymentConcept>();
  let acumulado = 0;
  let vivos = 0;

  for (const p of pagos) {
    if (p.anuladoAt != null) {
      out.set(p.id, p.concepto);
      continue;
    }
    if (!total || total <= 0) {
      out.set(p.id, p.conceptoManual ?? p.concepto);
      continue;
    }
    const deducido = deducirConcepto(acumulado, p.monto, total, vivos === 0);
    acumulado += p.monto;
    vivos++;
    const manual = p.conceptoManual;
    out.set(
      p.id,
      deducido === 'finiquito' || manual == null || manual === 'finiquito' || manual === 'complemento' ? deducido : manual,
    );
  }
  return out;
}
