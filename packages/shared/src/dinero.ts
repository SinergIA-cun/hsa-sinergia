import { z } from 'zod';

/**
 * Dinero con centavos (Jorge, 15-oct-2026: "en las horas extras necesitaba meter
 * centavos y no pudo").
 *
 * Los montos viajan como `number` en pesos (7850.5 = $7,850.50) y se guardan como
 * `double precision`. La coma flotante NO es exacta (0.1 + 0.2 = 0.30000000000000004),
 * así que hay dos reglas, y estas funciones son la única forma de cumplirlas:
 *
 * 1. Todo monto se redondea a centavos antes de guardarse o compararse
 *    (`centavos`).
 * 2. Toda suma o resta de montos se hace en centavos ENTEROS (`sumarDinero`,
 *    `restarDinero`): así un saldo que debe dar cero da cero, y no 5e-14.
 *
 * El catálogo (rentas, paquetes, servicios) sigue en pesos enteros; lo que lleva
 * centavos es el dinero que se mueve: pagos, cargos, depósitos, devoluciones y
 * los totales del evento.
 */

/** Redondea a centavos (medio centavo hacia arriba). `-0` sale como `0`. */
export function centavos(n: number): number {
  const r = Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
  return r === 0 ? 0 : r;
}

/** Suma montos en centavos enteros. */
export function sumarDinero(...montos: number[]): number {
  return montos.reduce((s, m) => s + Math.round(m * 100), 0) / 100;
}

/** `a - b`, en centavos enteros. */
export function restarDinero(a: number, b: number): number {
  return (Math.round(a * 100) - Math.round(b * 100)) / 100;
}

/** ¿Trae a lo más dos decimales? (7850.5 sí; 7850.555 no). */
export function tieneCentavosValidos(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

const MENSAJE = 'El monto admite a lo más dos decimales (centavos).';

/** Monto mayor que cero, con centavos. */
export const montoSchema = z.number().positive().refine(tieneCentavosValidos, MENSAJE);

/** Monto cero o mayor, con centavos. */
export const montoNoNegativoSchema = z.number().nonnegative().refine(tieneCentavosValidos, MENSAJE);

/** "$7,850" o "$7,850.50": los centavos solo cuando los hay, y siempre con dos cifras. */
export function pesosTexto(n: number): string {
  const r = centavos(n);
  return `$${r.toLocaleString('es-MX', Number.isInteger(r) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
