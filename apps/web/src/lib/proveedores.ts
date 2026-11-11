import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import type { ProductoProveedor, ProveedorConProductos } from './types.ts';

/** La lista del apartado "Proveedores" (ficha, productos y servicios del catálogo). */
export const PROVEEDORES_LISTA_KEY = ['proveedores'];

export function useProveedoresLista() {
  return useQuery({
    queryKey: PROVEEDORES_LISTA_KEY,
    queryFn: () => api.get<{ proveedores: ProveedorConProductos[] }>('/api/proveedores'),
    select: (d) => d.proveedores,
    staleTime: 60_000,
  });
}

/** "10%", "$2,000" o "sin comisión". */
export function textoComision(c: { comisionPct: number | null; comisionMonto: number | null }): string {
  if (c.comisionMonto != null) return `$${c.comisionMonto.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
  if (c.comisionPct != null) return `${c.comisionPct}%`;
  return 'sin comisión';
}

/** Un producto que se puede escoger al vender: activo y de un proveedor activo. */
export interface ProductoParaVender extends ProductoProveedor {
  proveedorNombre: string;
}

export function productosParaVender(proveedores: ProveedorConProductos[] | undefined): ProductoParaVender[] {
  return (proveedores ?? [])
    .filter((p) => p.activo)
    .flatMap((p) => p.productos.filter((x) => x.activo).map((x) => ({ ...x, proveedorNombre: p.nombre })));
}
