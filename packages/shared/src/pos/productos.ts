/**
 * Lo que se le puede cargar a un evento en el punto de venta.
 *
 * El punto de venta es lo que pasa DESPUÉS de contratar: "durante el evento
 * quieren extender, entonces agrego un producto a su cuenta que es horas extras y
 * pongo cuántas fueron" (el dueño). Nada de esto cambia el valor del evento: es
 * una venta aparte, casada a él, con sus propios pagos.
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
}

export const PRODUCTO_INFO: Record<ProductoCargo, ProductoInfo> = {
  horaExtra: { producto: 'horaExtra', nombre: 'Hora extra de salón', unidad: 'horas', precio: 'horaDeRenta', pideDescripcion: false },
  djHoraExtra: { producto: 'djHoraExtra', nombre: 'Hora extra de DJ', unidad: 'horas', precio: 'djDelCatalogo', pideDescripcion: false },
  invitadoExtra: { producto: 'invitadoExtra', nombre: 'Invitados extra', unidad: 'invitados', precio: 'rentaPorPersona', pideDescripcion: false },
  invitadoExtraAlimentos: {
    producto: 'invitadoExtraAlimentos',
    nombre: 'Invitados extra — alimentos',
    unidad: 'invitados',
    precio: 'alimentosPorPersona',
    pideDescripcion: false,
  },
  danos: { producto: 'danos', nombre: 'Daños a las instalaciones', unidad: 'piezas', precio: 'manual', pideDescripcion: true },
  multa: { producto: 'multa', nombre: 'Multa', unidad: 'multas', precio: 'manual', pideDescripcion: true },
  gastoImprevisto: { producto: 'gastoImprevisto', nombre: 'Gasto imprevisto', unidad: 'piezas', precio: 'manual', pideDescripcion: true },
  otro: { producto: 'otro', nombre: 'Otro', unidad: 'piezas', precio: 'manual', pideDescripcion: true },
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
