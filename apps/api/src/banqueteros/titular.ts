/**
 * Quién apartó la fecha, por nombre: el banquetero o, desde el 5-oct-2026, un
 * cliente directo (el BI trae fechas apartadas por clientes). Módulo hoja para
 * que disponibilidad, empalmes y agenda lo usen sin ciclos de importación.
 */
export function titularDeApartado(a: {
  banquetero?: { nombre: string } | null;
  client?: { nombre: string } | null;
}): string {
  return a.banquetero?.nombre ?? a.client?.nombre ?? 'Apartado';
}

/** El `include` mínimo para poder llamar a `titularDeApartado`. */
export const INCLUDE_TITULAR = {
  banquetero: { select: { nombre: true } },
  client: { select: { nombre: true } },
} as const;
