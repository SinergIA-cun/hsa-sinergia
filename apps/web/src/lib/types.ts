import type { QuoteBreakdown, Catalog as EngineCatalog } from '@hsa/shared';

export type { QuoteBreakdown, EngineCatalog };

export interface SessionUser {
  id: string;
  nombre: string;
  email: string;
  role: 'ventas' | 'admin';
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
  config?: { valetRatio: number };
}

export interface User {
  id: string;
  nombre: string;
  email: string;
  role: 'ventas' | 'admin';
  activo: boolean;
  createdAt: string;
}

export interface AdminConfig {
  ivaRate: number;
  extraHourRate: number;
  foodDiscountRate: number;
  valetRatio: number;
}

export interface Client {
  id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  empresa: string | null;
  numeroReferencia?: number;
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
  usaCapilla?: boolean;
  esCortesia?: boolean;
  usaDjHoraExtra?: boolean;
  horasEvento?: number | null;
  horarioCivil?: string | null;
  horaInicio?: string | null;
  horaTermino?: string | null;
  operativa?: HojaOperativa | null;
  foodPackageId: string | null;
  addOns?: { addOnId: string; cantidad: number }[];
  breakdown: QuoteBreakdown;
  total: number;
  rentaTotal: number;
  status: QuoteStatus;
  publicToken: string;
  createdAt: string;
  deletedAt?: string | null;
  createdBy?: { id: string; nombre: string } | null;
  desfase?: boolean;
}

export interface Payment {
  id: string;
  folio: number;
  monto: number;
  metodo: 'efectivo' | 'transferencia' | 'tarjeta';
  concepto: 'anticipo' | 'complemento' | 'aCuenta' | 'finiquito';
  fecha: string;
  referencia: string | null;
  comprobanteKey: string | null;
  anuladoAt: string | null;
  motivoAnulacion: string | null;
}

export interface HojaOperativa {
  nombreFestejado?: string;
  relacionCliente?: string;
  horaMisa?: string;
  capilla?: boolean;
  fotografia?: boolean;
  banquetero?: string;
  banqueteroPaqHsa?: boolean;
  estrado?: string;
  pista?: string;
  personalHsa?: string;
  personalSeguridadHora?: string;
  personalSeguridadElementos?: number;
  limpiezaNocturna?: boolean;
  habitacion?: string;
  seQuedaEquipo?: string;
  maniobras?: string;
}

export interface Milestone {
  key: 'apartar' | 'complemento' | 'finiquito';
  label: string;
  objetivo: number;
  cubierto: number;
  restante: number;
  completo: boolean;
  venceISO: string | null;
  porcentaje?: number;
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
  capillaOcupada: boolean;
}

export interface AgendaEvent {
  quoteId: string;
  cliente: string;
  eventoNombre: string;
  fechaEvento: string;
  spaceIds: string[];
  status: QuoteStatus;
  esCortesia: boolean;
}

export type Semaforo = 'verde' | 'amarillo' | 'rojo';

export interface DashboardData {
  kpis: { eventosMes: number };
  fichasSemana: {
    quoteId: string;
    cliente: string;
    evento: string;
    espacio: string;
    fechaEventoISO: string;
    finiquitoISO: string | null;
    semaforo: Semaforo;
    faltantes: string[];
  }[];
  proximaSemana: {
    quoteId: string;
    cliente: string;
    evento: string;
    espacio: string;
    fechaEventoISO: string;
    status: QuoteStatus;
    dia: 'viernes' | 'sabado' | 'domingo';
  }[];
  alertas: {
    quoteId: string;
    cliente: string;
    evento: string;
    fechaEventoISO: string;
    finiquitoISO: string | null;
    restante: number;
    diasVencido: number;
  }[];
}
