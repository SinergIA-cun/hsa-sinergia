import type { PrismaClient } from '@hsa/database';
import { QuoteError } from '../quotes/service.js';

/** Lo que trae un servicio del evento o un cargo sobre quién lo da. */
export interface ConProveedor {
  proveedor?: string | null;
  proveedorId?: string | null;
  productoProveedorId?: string | null;
}

/**
 * Valida y completa el proveedor y producto escogidos de "Proveedores"
 * (11-nov-2026) en servicios del evento o cargos.
 *
 * - El producto manda: trae a su proveedor, y uno de otro proveedor se rechaza.
 * - `proveedor` (el texto) queda con el nombre de hoy del proveedor escogido, para
 *   que lo vendido diga quién fue aunque después se desactive. Renombrarlo no
 *   cuenta como cambio del servicio: `cambiaronLosOtros` compara el id.
 * - Sin proveedor escogido, el texto tecleado se queda como está.
 *
 * Un proveedor o producto desactivado se acepta si ya venía en el renglón:
 * reeditar un evento viejo no tiene por qué fallar por eso.
 */
export async function ligarProveedores<T extends ConProveedor>(db: PrismaClient, items: T[]): Promise<T[]> {
  const prodIds = [...new Set(items.map((i) => i.productoProveedorId).filter((x): x is string => Boolean(x)))];
  const productos = prodIds.length
    ? await db.productoProveedor.findMany({ where: { id: { in: prodIds } }, select: { id: true, proveedorId: true } })
    : [];
  const proveedorDeProducto = new Map(productos.map((p) => [p.id, p.proveedorId]));
  for (const id of prodIds) {
    if (!proveedorDeProducto.has(id)) throw new QuoteError(400, 'Ese producto ya no está en Proveedores.');
  }

  const conProveedor = items.map((i) => {
    if (!i.productoProveedorId) return i;
    const delProducto = proveedorDeProducto.get(i.productoProveedorId)!;
    if (i.proveedorId && i.proveedorId !== delProducto) {
      throw new QuoteError(400, 'El producto escogido es de otro proveedor.');
    }
    return { ...i, proveedorId: delProducto };
  });

  const provIds = [...new Set(conProveedor.map((i) => i.proveedorId).filter((x): x is string => Boolean(x)))];
  const proveedores = provIds.length
    ? await db.proveedor.findMany({ where: { id: { in: provIds } }, select: { id: true, nombre: true } })
    : [];
  const nombre = new Map(proveedores.map((p) => [p.id, p.nombre]));
  return conProveedor.map((i) => {
    if (!i.proveedorId) return { ...i, proveedorId: null, productoProveedorId: null };
    const n = nombre.get(i.proveedorId);
    if (!n) throw new QuoteError(400, 'Ese proveedor ya no está en Proveedores.');
    return { ...i, proveedor: n };
  });
}
