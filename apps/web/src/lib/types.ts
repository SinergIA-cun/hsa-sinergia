import type { QuoteBreakdown, Catalog as EngineCatalog } from '@hsa/shared';

export type { QuoteBreakdown, EngineCatalog };

export interface SessionUser {
  id: string;
  nombre: string;
  email: string;
  role: 'vendedora' | 'admin';
}

export interface Space {
  id: string;
  nombre: string;
  capacidadMax: number | null;
  activo: boolean;
}

export interface FoodPackageBracket {
  min: number;
  max: number | null;
  pricePerPerson: number;
}

export interface FoodPackage {
  id: string;
  nombre: string;
  ivaIncluido: boolean;
  incluye: string | null;
  brackets: FoodPackageBracket[];
}

export interface EventType {
  id: string;
  nombre: string;
  slug: string;
  foodPackages: FoodPackage[];
  paymentRule: {
    apartarMonto: number;
    formalizarPct: number;
    liquidarDias: number;
  } | null;
}

export interface AddOn {
  id: string;
  nombre: string;
  kind: 'fijo' | 'porPersona' | 'porUnidad';
  price: number;
  activo: boolean;
}

export interface Catalog {
  engine: EngineCatalog;
  spaces: Space[];
  eventTypes: EventType[];
  addOns: AddOn[];
}

export interface Client {
  id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  empresa: string | null;
}

export const QUOTE_STATUSES = [
  'borrador',
  'enviada',
  'aceptada',
  'apartada',
  'formalizada',
  'liquidada',
  'vencida',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export interface Quote {
  id: string;
  clientId: string;
  client?: Client;
  eventTypeId: string;
  eventType?: { id: string; nombre: string; slug: string };
  fechaEvento: string;
  invitados: number;
  spaceIds: string[];
  horasExtra: number;
  foodPackageId: string | null;
  addOns?: { addOnId: string; cantidad: number }[];
  breakdown: QuoteBreakdown;
  total: number;
  rentaTotal: number;
  status: QuoteStatus;
  publicToken: string;
  createdAt: string;
  createdBy?: { id: string; nombre: string } | null;
}

export interface EstadoCuenta {
  total: number;
  pagado: number;
  saldo: number;
  pagos: unknown[];
  plan: unknown[];
}
