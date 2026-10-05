import type { QuoteBreakdown, QuoteLine } from '../types.js';

/**
 * Lo que se le puede cargar a un evento en el punto de venta.
 *
 * El punto de venta es lo que pasa DESPUÉS de contratar: "durante el evento
 * quieren extender, entonces agrego un producto a su cuenta que es horas extras y
 * pongo cuántas fueron" (el dueño).
 *
 * Dos clases (decisión del dueño, 5-oct-2026):
 * - **Suben el contrato** (`afectaContrato`): horas extra de salón y PAX extra
 *   (invitados de más, renta). Se suman al desglose del evento, suben su total y
 *   su saldo, y se cobran con pagos normales del evento.
 * - **Cuenta aparte**: lo demás (multas, daños, DJ, alimentos, PAX banquete…). No
 *   cambia el valor del evento y se cobra en la cuenta del punto de venta.
 *
 * Mismo juego de valores que el enum `ProductoCargo` de Postgres.
 */
export const PRODUCTOS_CARGO = [
  'horaExtra',
  'djHoraExtra',
  'invitadoExtra',
  'invitadoExtraAlimentos',
  'danos',
  'multa',
  'gastoImprevisto',
  'otro',
  'paxBanquete',
] as const;
export type ProductoCargo = (typeof PRODUCTOS_CARGO)[number];

/** Cómo se sugiere el precio unitario. Siempre se puede corregir a mano. */
export type PrecioProducto =
  /** 5% (o lo que diga el catálogo) de la renta del evento, por hora. */
  | 'horaDeRenta'
  /** El precio del DJ por hora extra del catálogo, según el tipo de evento. */
  | 'djDelCatalogo'
  /** La renta de una persona en el nivel del evento (precio del nivel ÷ su tope). */
  | 'rentaPorPersona'
  /** El precio por persona del paquete de alimentos del evento, en su nivel, con IVA. */
  | 'alimentosPorPersona'
  /** Lo teclea quien cobra: una multa o un daño no tienen tarifa. */
  | 'manual';

export interface ProductoInfo {
  producto: ProductoCargo;
  nombre: string;
  /** Lo que se cuenta: "horas", "invitados", "piezas". */
  unidad: string;
  precio: PrecioProducto;
  /** Si hay que describir qué pasó (un daño sin descripción no sirve de nada). */
  pideDescripcion: boolean;
  /** Sube el valor del contrato (se suma al desglose) en vez de ir a la cuenta aparte. */
  afectaContrato: boolean;
}

export const PRODUCTO_INFO: Record<ProductoCargo, ProductoInfo> = {
  horaExtra: { producto: 'horaExtra', nombre: 'Hora extra de salón', unidad: 'horas', precio: 'horaDeRenta', pideDescripcion: false, afectaContrato: true },
  djHoraExtra: { producto: 'djHoraExtra', nombre: 'Hora extra de DJ', unidad: 'horas', precio: 'djDelCatalogo', pideDescripcion: false, afectaContrato: false },
  invitadoExtra: { producto: 'invitadoExtra', nombre: 'Invitados extra (PAX)', unidad: 'invitados', precio: 'rentaPorPersona', pideDescripcion: false, afectaContrato: true },
  invitadoExtraAlimentos: {
    producto: 'invitadoExtraAlimentos',
    nombre: 'Invitados extra — alimentos',
    unidad: 'invitados',
    precio: 'alimentosPorPersona',
    pideDescripcion: false,
    afectaContrato: false,
  },
  danos: { producto: 'danos', nombre: 'Daños a las instalaciones', unidad: 'piezas', precio: 'manual', pideDescripcion: true, afectaContrato: false },
  multa: { producto: 'multa', nombre: 'Multa', unidad: 'multas', precio: 'manual', pideDescripcion: true, afectaContrato: false },
  gastoImprevisto: { producto: 'gastoImprevisto', nombre: 'Gasto imprevisto', unidad: 'piezas', precio: 'manual', pideDescripcion: true, afectaContrato: false },
  otro: { producto: 'otro', nombre: 'Otro', unidad: 'piezas', precio: 'manual', pideDescripcion: true, afectaContrato: false },
  // Personas adicionales del BANQUETERO: aparte de la renta, no sube el valor del
  // evento; el precio se teclea en cada cargo (decisión del dueño, 5-oct-2026).
  paxBanquete: { producto: 'paxBanquete', nombre: 'PAX banquete', unidad: 'invitados', precio: 'manual', pideDescripcion: false, afectaContrato: false },
}

/** ¿Este producto sube el valor del contrato? */
export const afectaContrato = (producto: ProductoCargo): boolean => PRODUCTO_INFO[producto].afectaContrato;

/**
 * El desglose del evento con los cargos que SUBEN EL CONTRATO puestos como
 * renglones de renta (marcados con `cargoId`). Idempotente: quita los que ya
 * tuviera y pone los que se le pasan, así sirve igual para agregar, anular o
 * volver a poner los cargos después de un recálculo del catálogo.
 *
 * Todo en renta trae IVA incluido, así que los totales se recalculan sumando.
 */
export function conCargosDelContrato(b: QuoteBreakdown, cargos: QuoteLine[], ivaRate: number): QuoteBreakdown {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lines = [...b.lines.filter((l) => !l.cargoId), ...cargos];
  const rentaTotal = r2(lines.filter((l) => l.grupo === 'renta').reduce((s, l) => s + l.monto, 0));
  const rentaSubtotal = r2(rentaTotal / (1 + ivaRate));
  const rentaIva = r2(rentaTotal - rentaSubtotal);
  const otrosTotal = b.otrosTotal ?? 0;
  const otrosSubtotal = b.otrosSubtotal ?? 0;
  const otrosIva = b.otrosIva ?? 0;
  return {
    ...b,
    lines,
    rentaTotal,
    rentaSubtotal,
    rentaIva,
    subtotal: r2(rentaSubtotal + otrosSubtotal),
    iva: r2(rentaIva + otrosIva),
    total: r2(rentaTotal + otrosTotal),
  };
}

/** El renglón de renta de un cargo que sube el contrato. */
export function lineaDeCargo(c: { id: string; producto: ProductoCargo; descripcion: string; cantidad: number; precioUnitario: number; total: number }): QuoteLine {
  return {
    concepto: c.descripcion || PRODUCTO_INFO[c.producto].nombre,
    detalle: `${c.cantidad} × $${c.precioUnitario.toLocaleString('es-MX')} · punto de venta`,
    monto: c.total,
    ivaIncluido: true,
    grupo: 'renta',
    cargoId: c.id,
  };
};

/** Un renglón del desglose guardado, lo mínimo que se necesita leer. */
interface LineaDesglose {
  concepto?: unknown;
  monto?: unknown;
  grupo?: unknown;
  spaceId?: unknown;
}

/**
 * La renta EFECTIVA del evento (`rentaBase` del motor): la de los espacios menos
 * el descuento de cortesía, sin horas extra ni capilla. Es la base de la hora
 * extra, igual que en el cotizador.
 *
 * Se lee del desglose GUARDADO y no se recalcula: el precio del evento ya está
 * firmado, y la hora extra se cobra sobre lo que se firmó.
 */
export function rentaBaseDeDesglose(breakdown: unknown): number {
  const lineas = (breakdown as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lineas)) return 0;
  return (lineas as LineaDesglose[])
    .filter(
      (l) =>
        l.grupo === 'renta' &&
        (typeof l.spaceId === 'string' ||
          (typeof l.concepto === 'string' && l.concepto.startsWith('Descuento de cortesía'))),
    )
    .reduce((s, l) => s + (typeof l.monto === 'number' ? l.monto : 0), 0);
}

/** Precio sugerido de una hora extra de salón, redondeado a pesos. */
export function precioHoraExtra(rentaBase: number, extraHourRate: number): number {
  return Math.max(0, Math.round(rentaBase * extraHourRate));
}

/** Lo que suma la cuenta del evento y lo que falta cobrar de ella. */
export function saldoDeCargos(
  cargos: readonly { total: number; anuladoAt: Date | string | null }[],
  pagos: readonly { monto: number; anuladoAt: Date | string | null }[],
): { total: number; pagado: number; saldo: number } {
  const total = cargos.filter((c) => c.anuladoAt == null).reduce((s, c) => s + c.total, 0);
  const pagado = pagos.filter((p) => p.anuladoAt == null).reduce((s, p) => s + p.monto, 0);
  return { total, pagado, saldo: total - pagado };
}
