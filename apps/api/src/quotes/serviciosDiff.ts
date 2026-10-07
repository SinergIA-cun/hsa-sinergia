import type { PrismaClient } from '@hsa/database';

/** Lo vendible de una cotización que no es renta: paquete, servicios y extras. */
export interface ServiciosDeCotizacion {
  foodPackageId: string | null;
  addOns: { addOnId: string; cantidad: number }[];
  extras: { nombre: string; kind: string; monto: number; cantidad: number }[];
  /** Lo que pone el banquetero (no entra al precio). */
  serviciosBanquetero?: { nombre: string; cantidad: number; monto: number | null }[];
}

interface Renglon {
  tipo: 'alimentos' | 'servicioCatalogo' | 'servicioEvento' | 'servicioBanquetero';
  id: string | null;
  nombre: string | null;
  detalle: Record<string, unknown>;
}

export interface CambiosDeServicios {
  agregados: Renglon[];
  quitados: Renglon[];
  cambiados: (Renglon & { antes: Record<string, unknown> })[];
}

/** Cada cosa vendida con una llave para emparejar antes contra después. */
function renglones(s: ServiciosDeCotizacion): Map<string, Renglon> {
  const m = new Map<string, Renglon>();
  if (s.foodPackageId) m.set(`alimentos:${s.foodPackageId}`, { tipo: 'alimentos', id: s.foodPackageId, nombre: null, detalle: {} });
  for (const a of s.addOns) {
    m.set(`servicio:${a.addOnId}`, { tipo: 'servicioCatalogo', id: a.addOnId, nombre: null, detalle: { cantidad: a.cantidad } });
  }
  // Los extras no tienen id (se recrean en cada edición): se emparejan por nombre.
  for (const e of s.extras) {
    m.set(`extra:${e.nombre.trim().toLowerCase()}`, {
      tipo: 'servicioEvento',
      id: null,
      nombre: e.nombre,
      detalle: { tipoCobro: e.kind, monto: e.monto, cantidad: e.cantidad },
    });
  }
  for (const b of s.serviciosBanquetero ?? []) {
    m.set(`banquetero:${b.nombre.trim().toLowerCase()}`, {
      tipo: 'servicioBanquetero',
      id: null,
      nombre: b.nombre,
      detalle: { cantidad: b.cantidad, monto: b.monto },
    });
  }
  return m;
}

/**
 * Qué se agregó, quitó o cambió de alimentos y servicios en una edición. Es lo
 * que deja ver al BI lo "agregado después de contratar" (`meta.servicios` de la
 * edición en `/cambios`). `null` si no cambió nada.
 */
export function cambiosDeServicios(antes: ServiciosDeCotizacion, despues: ServiciosDeCotizacion): CambiosDeServicios | null {
  const a = renglones(antes);
  const d = renglones(despues);
  const agregados = [...d].filter(([k]) => !a.has(k)).map(([, r]) => r);
  const quitados = [...a].filter(([k]) => !d.has(k)).map(([, r]) => r);
  const cambiados = [...d]
    .filter(([k, r]) => a.has(k) && JSON.stringify(a.get(k)!.detalle) !== JSON.stringify(r.detalle))
    .map(([k, r]) => ({ ...r, antes: a.get(k)!.detalle }));
  if (agregados.length + quitados.length + cambiados.length === 0) return null;
  return { agregados, quitados, cambiados };
}

/** Le pone nombre y clave fija a los paquetes y servicios del catálogo. */
export async function conNombres(db: PrismaClient, c: CambiosDeServicios) {
  const todos = [...c.agregados, ...c.quitados, ...c.cambiados];
  const ids = (tipo: Renglon['tipo']) => todos.filter((r) => r.tipo === tipo && r.id).map((r) => r.id!);
  const [servicios, paquetes] = await Promise.all([
    db.addOn.findMany({ where: { id: { in: ids('servicioCatalogo') } }, select: { id: true, clave: true, nombre: true } }),
    db.foodPackage.findMany({ where: { id: { in: ids('alimentos') } }, select: { id: true, clave: true, nombre: true } }),
  ]);
  const porId = new Map([...servicios, ...paquetes].map((x) => [x.id, x]));
  const poner = <T extends Renglon>(r: T) => {
    const x = r.id ? porId.get(r.id) : undefined;
    return { ...r, clave: x?.clave ?? null, nombre: r.nombre ?? x?.nombre ?? null };
  };
  return { agregados: c.agregados.map(poner), quitados: c.quitados.map(poner), cambiados: c.cambiados.map(poner) };
}
