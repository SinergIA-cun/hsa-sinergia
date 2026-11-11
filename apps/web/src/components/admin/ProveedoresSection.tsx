import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';
import type { Proveedor } from '../../lib/types.ts';

export const PROVEEDORES_KEY = ['admin-proveedores'];

/**
 * Los proveedores, para el selector de cada servicio del catálogo. Se dan de alta
 * y se editan en su propia pantalla, `/proveedores` (11-nov-2026).
 */
export function useProveedores() {
  return useQuery({
    queryKey: PROVEEDORES_KEY,
    queryFn: () => api.get<{ proveedores: Proveedor[] }>('/api/admin/proveedores'),
    select: (d) => d.proveedores,
  });
}
