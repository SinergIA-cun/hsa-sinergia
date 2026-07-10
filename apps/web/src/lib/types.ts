import type { QuoteBreakdown, Catalog as EngineCatalog } from '@hsa/shared';

export type { QuoteBreakdown, EngineCatalog };

export interface SessionUser {
  id: string;
  nombre: string;
  email: string;
  role: 'vendedora' | 'admin';
}

export interface SpacePaymentRule {
  anticipo: number;
  complementoPct: number;
  liquidarDiasAntes: number;
}

export interface Space {
  id: string;
  nombre: string;
  capacidadMax: number | null;
  activo: boolean;
  paymentRule?: SpacePaymentRule | null;
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

export interface Payment {
  id: string;
  monto: number;
  metodo: 'efectivo' | 'transferencia' | 'tarjeta';
  concepto: 'anticipo' | 'complemento' | 'aCuenta' | 'finiquito';
  fecha: string;
  referencia: string | null;
  anuladoAt: string | null;
  motivoAnulacion: string | null;
}

export interface Milestone {
  key: 'apartar' | 'complemento' | 'finiquito';
  label: string;
  objetivo: number;
  cubierto: number;
  completo: boolean;
  venceISO: string | null;
}

export interface EstadoCuenta {
  total: number;
  pagado: number;
  saldo: number;
  plan: Milestone[] | null;
  planPendiente: boolean;
  sugerido: 'apartada' | 'formalizada' | 'liquidada' | null;
  desfase: boolean;
  pagos?: unknown[];
}

export interface ActivityEntry {
  id: string;
  tipo: 'creada' | 'estatus' | 'pago' | 'pagoAnulado' | 'edicion';
  descripcion: string;
  createdAt: string;
  actor?: { nombre: string } | null;
}

export interface QuoteDetail {
  quote: Quote;
  estadoCuenta: EstadoCuenta;
  payments: Payment[];
  activityLog: ActivityEntry[];
}

export type AvailabilityLevel = 'libre' | 'cotizaciones' | 'apartada' | 'bloqueada';

export interface SpaceAvailability {
  spaceId: string;
  nombre: string;
  level: AvailabilityLevel;
  counts: { cotizaciones: number; apartadas: number; formalizadas: number; liquidadas: number };
  quotes: { id: string; cliente: string; status: string }[];
}

export interface Availability {
  fecha: string;
  spaces: SpaceAvailability[];
  blocked: boolean;
}

export interface AgendaEvent {
  quoteId: string;
  cliente: string;
  eventoNombre: string;
  fechaEvento: string;
  spaceIds: string[];
  status: QuoteStatus;
}
