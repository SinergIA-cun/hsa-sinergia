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
