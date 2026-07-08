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
  rentalPrices: RentalPriceRow[];
  foodPackages: FoodPackage[];
  addOns: AddOn[];
}

// QuoteSelection se define en schemas.ts (derivado del esquema zod) para evitar
// duplicar la forma. Ver `./schemas.ts`.

export interface QuoteLine {
  concepto: string;
  detalle?: string;
  monto: number;                // por línea; la renta ya trae IVA, las bases no
  ivaIncluido: boolean;
}

export interface QuoteBreakdown {
  lines: QuoteLine[];
  subtotal: number;             // genuinamente pre-IVA (interno, no fiscal/CFDI)
  iva: number;                  // impuesto total real (renta embebido + bases)
  total: number;                // subtotal + iva
  rentaTotal: number;           // renta con IVA (base del plan de pagos)
}
