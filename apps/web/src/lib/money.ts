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

/** Formatea pesos sin centavos (para totales redondeados). */
export function formatMXN(n: number): string {
  return mxn.format(n);
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
