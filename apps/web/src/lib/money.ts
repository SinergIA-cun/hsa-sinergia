const mxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const mxnCents = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formatea pesos: sin decimales si el monto es entero ("$7,850") y con sus dos
 * decimales si trae centavos ("$7,850.50"). Así nada de lo que ya se veía cambia.
 */
export function formatMXN(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? mxn.format(r) : mxnCents.format(r);
}

/** ¿Lo tecleado es un monto válido? Pesos con a lo más dos decimales y mayor a cero. */
export function esMontoValido(texto: string, { permitirCero = false } = {}): boolean {
  const t = texto.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return false;
  const n = Number(t);
  return permitirCero ? n >= 0 : n > 0;
}

/** Formatea pesos con centavos (para líneas de desglose). */
export function formatMXNCents(n: number): string {
  return mxnCents.format(n);
}

/** Porcentaje legible: 10 → "10%", 20.5 → "20.5%". Evita el "10.0%" de toFixed. */
export function formatPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

/**
 * Porcentaje legible a partir de una fracción: 0.1 → "10%", 0.125 → "12.5%".
 *
 * Redondea a un decimal antes de formatear porque `0.1 * 100` da
 * 10.000000000000002 en coma flotante, y eso se imprimiría como "10.0%".
 */
export function formatPctFraccion(fraccion: number): string {
  return formatPct(Math.round(fraccion * 1000) / 10);
}
