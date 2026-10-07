import type { CobraServicio, QuoteLine, TipoRenglon, UnidadRenglon } from '../types.js';

/**
 * Un renglón del desglose de un evento, como lo lee el BI (`desglose[]` en
 * `/eventos`). Lo vendido en datos —tipo, cantidad, precio— y no en el texto del
 * concepto.
 */
export interface RenglonBI {
  /** Fijo mientras el renglón exista: `quoteId:tipo[:id]`. */
  id: string;
  bloque: 'renta' | 'otros';
  /** `otro` = un renglón de un desglose guardado antes de que el motor lo etiquetara. */
  tipo: TipoRenglon | 'otro';
  /** spaceId, foodPackageId, addOnId o producto del punto de venta (ver `LineaRef.id`). */
  refId: string | null;
  nombre: string;
  detalle: string | null;
  cantidad: number;
  unidad: UnidadRenglon;
  /** Con IVA. */
  precioUnitario: number;
  /** Sin IVA. */
  subtotal: number;
  /** Con IVA. Los de un bloque suman exacto el total del bloque. */
  total: number;
  origen: 'contrato' | 'puntoDeVenta';
  cargoId: string | null;
  /** Solo `servicioCatalogo` guardado desde el 6-oct-2026: proveedor, comisión y
   *  quién cobra, congelados con el evento. Sin esto, el lector los toma del catálogo. */
  servicio?: { proveedorId: string | null; comisionPct: number | null; cobra: CobraServicio };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** El tipo de un renglón guardado sin `ref`: lo poco que se sabe sin leer el texto. */
function tipoSinRef(l: QuoteLine): TipoRenglon | 'otro' {
  if (l.cargoId) return 'cargoContrato';
  if (l.grupo === 'renta' && l.spaceId) return 'rentaSalon';
  return 'otro';
}

/**
 * Convierte los renglones del desglose guardado en los del BI.
 *
 * - Todo en pesos con IVA (los servicios del catálogo y el paquete sin IVA lo
 *   llevan agregado, igual que en los totales del motor).
 * - Los renglones de cada bloque suman exacto `rentaTotal` y `otrosTotal`: el
 *   último de cada bloque absorbe los centavos de redondeo, como `rentaPorSalon`.
 */
export function desgloseParaBI(
  lines: QuoteLine[],
  args: { quoteId: string; ivaRate: number; rentaTotal: number; otrosTotal: number },
): RenglonBI[] {
  const conIva = (n: number, incluido: boolean) => (incluido ? n : n * (1 + args.ivaRate));
  const vistos = new Map<string, number>();

  const renglones = lines.map((l, i): RenglonBI => {
    const tipo = l.ref?.tipo ?? tipoSinRef(l);
    const refId = l.ref?.id ?? (tipo === 'rentaSalon' ? l.spaceId ?? null : null);
    let id = l.cargoId
      ? `${args.quoteId}:cargo:${l.cargoId}`
      : tipo === 'otro'
        ? `${args.quoteId}:otro:${i + 1}`
        : `${args.quoteId}:${tipo}${refId ? `:${refId}` : ''}`;
    // El mismo servicio dos veces en un evento: el segundo lleva su número.
    const n = (vistos.get(id) ?? 0) + 1;
    vistos.set(id, n);
    if (n > 1) id = `${id}:${n}`;

    const total = r2(conIva(l.monto, l.ivaIncluido));
    return {
      id,
      bloque: l.grupo,
      tipo,
      refId,
      nombre: l.concepto,
      detalle: l.detalle ?? null,
      cantidad: l.ref?.cantidad ?? 1,
      unidad: l.ref?.unidad ?? 'evento',
      precioUnitario: r2(conIva(l.ref?.precioUnitario ?? l.monto, l.ivaIncluido)),
      subtotal: r2(l.ivaIncluido ? l.monto / (1 + args.ivaRate) : l.monto),
      total,
      origen: l.cargoId ? 'puntoDeVenta' : 'contrato',
      cargoId: l.cargoId ?? null,
      ...(tipo === 'servicioCatalogo' && l.ref?.cobra
        ? { servicio: { proveedorId: l.ref.proveedorId ?? null, comisionPct: l.ref.comisionPct ?? null, cobra: l.ref.cobra } }
        : {}),
    };
  });

  return [
    ...cuadrar(renglones.filter((r) => r.bloque === 'renta'), args.rentaTotal),
    ...cuadrar(renglones.filter((r) => r.bloque === 'otros'), args.otrosTotal),
  ];
}

/** El último renglón absorbe la diferencia de redondeo contra el total del bloque. */
function cuadrar(renglones: RenglonBI[], total: number): RenglonBI[] {
  if (renglones.length === 0) return renglones;
  const suma = renglones.reduce((s, r) => s + r.total, 0);
  const dif = r2(total - suma);
  if (dif === 0) return renglones;
  const ultimo = renglones[renglones.length - 1]!;
  return [...renglones.slice(0, -1), { ...ultimo, total: r2(ultimo.total + dif) }];
}
