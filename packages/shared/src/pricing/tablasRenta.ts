import type { Catalog, RentalPriceRow } from '../types.js';

export const MENSAJE_SIN_TABLA = 'Este tipo de evento no tiene tabla de renta en este catálogo.';

/**
 * Con qué tabla de renta se cobra un tipo de evento (21-oct-2026): la que lo
 * tenga elegido. Sin tipo de evento, la primera. `nombre` solo viene cuando el
 * catálogo tiene más de una tabla: con una sola, decirlo sobra.
 *
 * Un tipo que no está en ninguna tabla no se puede cotizar: se dice así, en vez
 * de cobrarle con la de otro.
 */
export function tablaDeRenta(
  catalog: Catalog,
  eventTypeId: string | null | undefined,
): { rows: RentalPriceRow[]; nombre?: string } {
  const tablas = catalog.tablasRenta;
  if (!tablas?.length) {
    const usaFlat = eventTypeId != null && catalog.flatRentalEventTypeIds.includes(eventTypeId);
    return usaFlat ? { rows: catalog.rentalPricesFlat, nombre: 'renta plana' } : { rows: catalog.rentalPrices };
  }
  const tabla = eventTypeId ? tablas.find((t) => t.eventTypeIds.includes(eventTypeId)) : tablas[0];
  if (!tabla) throw new Error(MENSAJE_SIN_TABLA);
  return { rows: tabla.rows, ...(tablas.length > 1 ? { nombre: tabla.nombre } : {}) };
}
