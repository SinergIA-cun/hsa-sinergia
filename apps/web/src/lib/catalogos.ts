import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import type { PriceList } from './types.ts';

/**
 * Llave compartida: la pantalla de admin y el modal de "mover de catálogo" leen
 * el MISMO caché. Con dos llaves distintas, clonar un catálogo lo dejaría fuera
 * del select del modal hasta recargar la página.
 */
export const PRICE_LISTS_KEY = ['admin-price-lists'] as const;

/** Los catálogos versionados con sus conteos de uso. Solo admin. */
export function usePriceLists() {
  return useQuery({
    queryKey: PRICE_LISTS_KEY,
    queryFn: () => api.get<{ priceLists: PriceList[] }>('/api/admin/price-lists'),
  });
}
