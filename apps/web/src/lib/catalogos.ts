import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';
import type { CambioCatalogo, CatalogoContenido, ImpactoCatalogo, PriceList } from './types.ts';

/**
 * Llave compartida: la pantalla de admin y el modal de "mover de catálogo" leen
 * el MISMO caché. Con dos llaves distintas, clonar un catálogo lo dejaría fuera
 * del select del modal hasta recargar la página.
 */
export const PRICE_LISTS_KEY = ['admin-price-lists'] as const;

export const contenidoKey = (id: string) => ['catalogo-contenido', id] as const;
export const impactoKey = (id: string) => ['catalogo-impacto', id] as const;
export const bitacoraKey = (id: string) => ['catalogo-bitacora', id] as const;

/** Los catálogos versionados con sus conteos de uso. Solo admin. */
export function usePriceLists() {
  return useQuery({
    queryKey: PRICE_LISTS_KEY,
    queryFn: () => api.get<{ priceLists: PriceList[] }>('/api/admin/price-lists'),
  });
}

/** Todo lo editable de un catálogo, con los ids que necesitan los PATCH. */
export function useCatalogoContenido(id: string) {
  return useQuery({
    queryKey: contenidoKey(id),
    queryFn: () =>
      api.get<{ contenido: CatalogoContenido }>(`/api/admin/price-lists/${id}/contenido`),
  });
}

/** Cuántas cotizaciones puede represiar editar este catálogo, por estatus. */
export function useCatalogoImpacto(id: string) {
  return useQuery({
    queryKey: impactoKey(id),
    queryFn: () => api.get<{ impacto: ImpactoCatalogo }>(`/api/admin/price-lists/${id}/impacto`),
  });
}

/** La bitácora del catálogo: quién cambió qué y cuántas había en riesgo entonces. */
export function useCatalogoBitacora(id: string) {
  return useQuery({
    queryKey: bitacoraKey(id),
    queryFn: () => api.get<{ bitacora: CambioCatalogo[] }>(`/api/admin/price-lists/${id}/bitacora`),
  });
}

/**
 * Lo que hay que refrescar después de CUALQUIER cambio al contenido de un
 * catálogo.
 *
 * `['catalog']` es la del cotizador y no es opcional: sin invalidarla, el
 * formulario sigue calculando con los precios viejos hasta que alguien recargue
 * la página, y ya pasó en este repo. La invalidación por prefijo alcanza también
 * a `['catalog', priceListId]` —la que usan la edición de una cotización y la
 * agenda para el catálogo AL QUE ESTÁ CASADA—, así que las dos quedan cubiertas
 * con esta llamada.
 *
 * `PRICE_LISTS_KEY` va porque el listado muestra los conteos y los parámetros.
 */
export function useInvalidarCatalogo(id: string) {
  const qc = useQueryClient();
  return async function invalidar(): Promise<void> {
    await Promise.all([
      qc.invalidateQueries({ queryKey: contenidoKey(id) }),
      qc.invalidateQueries({ queryKey: impactoKey(id) }),
      qc.invalidateQueries({ queryKey: bitacoraKey(id) }),
      qc.invalidateQueries({ queryKey: PRICE_LISTS_KEY }),
      qc.invalidateQueries({ queryKey: ['catalog'] }),
    ]);
  };
}
