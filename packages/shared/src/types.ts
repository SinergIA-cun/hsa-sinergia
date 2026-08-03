export type DayType = 'viernes' | 'viernesEspecial' | 'sabado' | 'domAJue';

/** Rango de capacidad: [min, max] inclusivo. max = null => sin tope. */
export interface CapacityBracket {
  min: number;
  max: number | null;
}

export interface RentalPriceRow extends CapacityBracket {
  spaceId: string;
  prices: Record<DayType, number>; // con IVA, en pesos
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
}

export interface Catalog {
  ivaRate: number;              // 0.16
  extraHourRate: number;        // 0.05 de la renta por hora
  foodDiscountRate: number;     // 0.05 de la renta si hay alimentos
  capillaSabado: number;        // renta de capilla en sábado (cortesía el resto)
  djHoraExtraByEventType: Record<string, number>; // precio del DJ por hora extra, por eventTypeId
  rentalPrices: RentalPriceRow[];      // renta por tipo de día (eventos normales)
  rentalPricesFlat: RentalPriceRow[];  // renta plana (Team Building): mismo precio todos los días
  flatRentalEventTypeIds: string[];    // tipos de evento que usan la renta plana
  foodPackages: FoodPackage[];
  addOns: AddOn[];
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
