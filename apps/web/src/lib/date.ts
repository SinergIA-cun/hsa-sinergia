// La fecha del evento se guarda en UTC medianoche (`YYYY-MM-DDT00:00:00.000Z`).
// Debe formatearse SIEMPRE en UTC para que el día calendario no se corra según
// la zona horaria del navegador (México UTC-6 restaba un día). Ver bug fecha off-by-one.

type EventDateStyle = 'short' | 'long';

const short: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
};

const long: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
};

/** Formatea la fecha de un evento (ISO o `YYYY-MM-DD`) en UTC, sin corrimiento de día. */
export function formatEventDate(iso: string, style: EventDateStyle = 'short'): string {
  const date = iso.length === 10 ? new Date(`${iso}T00:00:00.000Z`) : new Date(iso);
  return date.toLocaleDateString('es-MX', style === 'long' ? long : short);
}

/** Formatea un timestamp real (createdAt, etc.) en hora local del navegador. */
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Fecha Y hora. La usa la bitácora forense, donde el día no basta: "lo cambiaron
 * el 24 de agosto" y "lo cambiaron el 24 de agosto a las 3:40 de la mañana" son
 * dos hallazgos distintos.
 */
export function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
