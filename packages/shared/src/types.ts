export type DayType = 'viernes' | 'viernesEspecial' | 'sabado' | 'domAJue';

/** Rango de capacidad: [min, max] inclusivo. max = null => sin tope. */
export interface CapacityBracket {
  min: number;
  max: number | null;
}

export interface RentalPriceRow extends CapacityBracket {
  spaceId: string;
  /** Con IVA, en pesos. `null` = no aplica: ese día no se ofrece (ver `precioDelDia`). */
  prices: Record<DayType, number | null>;
}

export interface FoodPackageRow extends CapacityBracket {
  packageId: string;
  pricePerPerson: number; // sin IVA
}

export interface FoodPackage {
  id: string;
  eventTypeId: string;
  name: string;
  ivaIncluded: boolean; // en la tabla; si false, se agrega IVA
  brackets: FoodPackageRow[];
}

export type AddOnKind = 'fijo' | 'porPersona' | 'porUnidad';

export interface AddOn {
  id: string;
  name: string;
  kind: AddOnKind;
  price: number; // sin IVA
  /** Si se sigue OFRECIENDO en el cotizador. Distinto de si el catálogo lo
   *  RESUELVE: los inactivos siguen presentes para poder recalcular las
   *  cotizaciones ya emitidas que los referencian por id. El motor no
   *  distingue —cobra igual— y la interfaz es la que deja de ofrecerlos. */
  activo: boolean;
}

export interface Catalog {
  ivaRate: number;              // 0.16
  extraHourRate: number;        // 0.05 de la renta por hora
  foodDiscountRate: number;     // 0.05 de la renta si hay alimentos
  capillaSabado: number;        // renta de capilla en sábado (cortesía el resto)
  /** Hasta cuántas personas por encima del tope de un nivel se cobran como
   *  "personas extra" del nivel anterior en vez de brincar al siguiente. 0 = nunca. */
  toleranciaExtras?: number;
  djHoraExtraByEventType: Record<string, number>; // precio del DJ por hora extra, por eventTypeId
  rentalPrices: RentalPriceRow[];      // renta por tipo de día (eventos normales)
  rentalPricesFlat: RentalPriceRow[];  // renta plana (Team Building): mismo precio todos los días
  flatRentalEventTypeIds: string[];    // tipos de evento que usan la renta plana
  foodPackages: FoodPackage[];
  addOns: AddOn[];
  /** Nombre de cada espacio por id, para que un error diga "Arcos" y no un id. */
  spaceNames?: Record<string, string>;
}

// QuoteSelection se define en schemas.ts (derivado del esquema zod) para evitar
// duplicar la forma. Ver `./schemas.ts`.

/** Grupo de cobro: `renta` la cobra HSA; `otros` (alimentos y servicios) suele
 *  pagarse directo al proveedor. Permite mostrar dos subtotales separados. */
export type QuoteGroup = 'renta' | 'otros';

export interface QuoteLine {
  concepto: string;
  detalle?: string;
  monto: number;                // por línea; la renta ya trae IVA, las bases no
  ivaIncluido: boolean;
  grupo: QuoteGroup;
  /** Solo en las líneas de renta de espacio: a qué espacio corresponde el monto.
   *  Es el dato que permite repartir el plan de pagos entre varios salones sin
   *  tener que interpretar el texto del concepto. */
  spaceId?: string;
  /** Si el renglón es un cargo del punto de venta que sube el contrato (horas
   *  extra, PAX extra): el id del cargo. Se quita y se vuelve a poner con él. */
  cargoId?: string;
  /** Qué es el renglón, en datos y no en texto: lo lee el BI (`desglose[]`). Los
   *  desgloses guardados antes del 6-oct-2026 pueden no traerlo. */
  ref?: LineaRef;
}

/** Qué se vendió en un renglón del desglose. */
export type TipoRenglon =
  | 'rentaSalon'
  | 'descuento'
  | 'horasExtra'
  | 'capilla'
  | 'descuentoAlimentos'
  | 'cargoContrato'
  | 'alimentos'
  | 'servicioCatalogo'
  | 'djHoraExtra'
  | 'servicioEvento'
  | 'pactado';

export type UnidadRenglon = 'evento' | 'personas' | 'horas' | 'unidades';

export interface LineaRef {
  tipo: TipoRenglon;
  /** spaceId (rentaSalon), foodPackageId (alimentos), addOnId (servicioCatalogo),
   *  producto del punto de venta (cargoContrato), posición del extra
   *  (servicioEvento). Sin `id` en los demás. */
  id?: string;
  cantidad: number;
  unidad: UnidadRenglon;
  /** En la misma base que `monto`: con IVA si `ivaIncluido`, sin IVA si no. */
  precioUnitario: number;
}

export interface QuoteBreakdown {
  lines: QuoteLine[];
  subtotal: number;             // genuinamente pre-IVA (interno, no fiscal/CFDI)
  iva: number;                  // impuesto total real (renta embebido + bases)
  total: number;                // subtotal + iva
  // Bloque RENTA (lo que cobra HSA; base del plan de pagos): subtotal + iva === total.
  rentaSubtotal: number;
  rentaIva: number;
  rentaTotal: number;
  // Bloque OTROS (alimentos + servicios; se paga al proveedor): subtotal + iva === total.
  otrosSubtotal: number;
  otrosIva: number;
  otrosTotal: number;
}
