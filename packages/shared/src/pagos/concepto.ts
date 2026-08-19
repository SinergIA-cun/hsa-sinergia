import { z } from 'zod';

/**
 * Concepto de un pago. `aCuenta` es el abono que no cruza ningún hito del plan.
 *
 * Es el mismo juego de valores que el enum `PaymentConcept` de Postgres; vive
 * aquí para que la deducción sea una función pura, sin Prisma de por medio.
 */
export const paymentConceptSchema = z.enum(['anticipo', 'complemento', 'aCuenta', 'finiquito']);
export type PaymentConcept = z.infer<typeof paymentConceptSchema>;

/**
 * Los tres objetivos ACUMULADOS del plan de pagos, en pesos. Son los mismos que
 * imprime el estado de cuenta: `apartar` ≤ `complemento` ≤ `finiquito`.
 *
 * Ojo: son acumulados, no incrementos. `complemento` incluye el anticipo, y
 * `finiquito` es la renta completa.
 */
export interface HitosPago {
  apartar: number;
  complemento: number;
  finiquito: number;
}

/** Lo que la deducción necesita saber de un pago. */
export interface PagoParaConcepto {
  id: string;
  monto: number;
  /** Un pago anulado no suma al acumulado: para el plan, no existió. */
  anuladoAt: Date | null;
  /** El concepto que alguien capturó o corrigió a mano. `null` = nadie discrepó. */
  conceptoManual?: PaymentConcept | null;
  /** El concepto que hoy está guardado. Es el que se respeta cuando no hay plan. */
  concepto: PaymentConcept;
}

/**
 * El concepto que le toca a UN pago según dónde deja el acumulado.
 *
 * `antes` es lo pagado (vivo) antes de este pago; `antes + monto` es lo pagado
 * después. Se compara contra los hitos y gana el más alto que este pago cruce:
 *
 * - Deja el acumulado en el total ⇒ `finiquito`. Es el que cierra la cuenta.
 * - Cruza el objetivo del complemento ⇒ `complemento`.
 * - Cruza el objetivo del anticipo ⇒ `anticipo`.
 * - No cruza ninguno ⇒ `aCuenta`.
 *
 * "Cruzar" es estricto por abajo: el pago que cruza es el que llevó el acumulado
 * de *no alcanzar* el hito a *alcanzarlo*. Los que vienen después de un hito ya
 * cubierto no lo vuelven a cruzar, así que son `aCuenta` hasta el siguiente.
 *
 * Un pago que se pasa del total sigue siendo `finiquito`: pagar de más no
 * convierte el finiquito en otra cosa.
 */
export function deducirConcepto(antes: number, monto: number, hitos: HitosPago): PaymentConcept {
  const despues = antes + monto;
  if (antes < hitos.finiquito && despues >= hitos.finiquito) return 'finiquito';
  if (antes < hitos.complemento && despues >= hitos.complemento) return 'complemento';
  if (antes < hitos.apartar && despues >= hitos.apartar) return 'anticipo';
  return 'aCuenta';
}

/**
 * El concepto EFECTIVO de cada pago, deducido del acumulado.
 *
 * `pagos` tiene que venir en el orden en que se aplicaron (fecha, y `createdAt`
 * para desempatar el mismo día): el concepto de un pago depende de lo que había
 * pagado antes de él, así que el orden es parte del resultado.
 *
 * Dos reglas que el dueño pidió explícitamente:
 *
 * 1. **La del finiquito gana siempre sobre lo capturado**: "debe moverse a
 *    finiquito solo, si ya fue el pago que finiquitó. Sin importar como pusieron
 *    el campo." Va en los dos sentidos — el pago que cierra la cuenta es
 *    finiquito aunque lo hayan capturado como anticipo, y un pago marcado
 *    "finiquito" a mano que NO cierra la cuenta no lo es. La etiqueta de
 *    finiquito la manda el saldo, no la captura.
 * 2. **Sin plan de pagos no se inventa nada.** Cuatro espacios todavía no tienen
 *    montos definidos y su plan queda pendiente; ahí se respeta lo capturado.
 *
 * Los pagos anulados conservan el concepto con el que quedaron: son evidencia de
 * auditoría, no participan del acumulado y no se reescriben.
 */
export function deducirConceptos(
  pagos: PagoParaConcepto[],
  hitos: HitosPago | null,
): Map<string, PaymentConcept> {
  const out = new Map<string, PaymentConcept>();
  let acumulado = 0;

  for (const p of pagos) {
    if (p.anuladoAt != null) {
      out.set(p.id, p.concepto);
      continue;
    }
    if (!hitos) {
      out.set(p.id, p.conceptoManual ?? p.concepto);
      continue;
    }

    const deducido = deducirConcepto(acumulado, p.monto, hitos);
    acumulado += p.monto;

    // El manual solo puede discrepar en los tres conceptos que no son el
    // finiquito: ese lo dicta el saldo (regla 1).
    const manual = p.conceptoManual;
    out.set(
      p.id,
      deducido === 'finiquito' || manual == null || manual === 'finiquito' ? deducido : manual,
    );
  }
  return out;
}
