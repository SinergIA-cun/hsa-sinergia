import type { DayType } from '../types.js';

/**
 * El precio de un renglón de renta para un tipo de día, o `null` si ese día no
 * se ofrece.
 *
 * Un precio en `null` es "no aplica" (decisión del dueño, 1-oct-2026). Antes la
 * única forma de apagar un día era capturarlo en cero, y el motor lo cobraba
 * como renta de $0.
 *
 * El **viernes especial** es una promoción (mar–may y sep–oct): si no aplica, ese
 * viernes se cobra como viernes normal. Los demás días no tienen a dónde caer:
 * si no aplican, no se ofrecen.
 */
export function precioDelDia(prices: Record<DayType, number | null>, dia: DayType): number | null {
  const p = prices[dia];
  if (p != null) return p;
  return dia === 'viernesEspecial' ? prices.viernes ?? null : null;
}

/** Cómo se dice cada tipo de día en un mensaje. */
export const NOMBRE_DIA: Record<DayType, string> = {
  viernes: 'viernes',
  viernesEspecial: 'viernes especial',
  sabado: 'sábado',
  domAJue: 'domingo a jueves',
};
