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
}

export interface Client {
  id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  empresa: string | null;
  numeroReferencia?: number;
  rfc?: string | null;
  razonSocial?: string | null;
  regimenFiscal?: string | null;
  cpFiscal?: string | null;
  usoCfdi?: string | null;
  correoFacturacion?: string | null;
}

export const QUOTE_STATUSES = [
  'borrador',
  'enviada',
  'aceptada',
  'formalizada',
  'complementada',
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
  capillaHorario?: string | null;
  esCortesia?: boolean;
  usaDjHoraExtra?: boolean;
  requiereFactura?: boolean;
  banqueteroId?: string | null;
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
  // Candado de facturación: el servidor lo calcula al vuelo con el calendario.
  facturable?: boolean;
  motivoFactura?: string | null;
  facturadoAt?: string | null;
  desbloqueoAt?: string | null;
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
  personalHsaRows?: PersonalHsaRow[];
  personalSeguridadHora?: string;
  personalSeguridadElementos?: number;
  limpiezaNocturna?: boolean;
  habitacion?: string;
  seQuedaEquipo?: string;
  maniobras?: boolean;
  anotaciones?: string;
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
  sugerido: 'formalizada' | 'complementada' | 'liquidada' | null;
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
  /** `editable: false` cuando ya no queda ningún pago facturable. */
  fiscalEditable?: { editable: boolean; motivo: string | null };
  activityLog: ActivityEntry[];
}

export type AvailabilityLevel = 'libre' | 'cotizaciones' | 'bloqueada';

export interface SpaceAvailability {
  spaceId: string;
  nombre: string;
  level: AvailabilityLevel;
  counts: { cotizaciones: number; formalizadas: number; complementadas: number; liquidadas: number };
  quotes: { id: string; cliente: string; status: string }[];
}

export interface CapillaEvento {
  quoteId: string;
  cliente: string;
  horario: string | null;
}

export interface Banquetero {
  id: string;
  nombre: string;
  telefono?: string | null;
  activo: boolean;
  createdAt?: string;
}

export interface VentaBanquetero {
  banqueteroId: string;
  nombre: string;
  eventos: number;
  totalContratos: number;
  totalRenta: number;
  invitados: number;
}

export interface Empleado {
  id: string;
  nombre: string;
  rol?: string | null;
  activo: boolean;
  createdAt?: string;
}

export interface CuadrillaMiembro {
  id: string;
  empleado: { id: string; nombre: string; rol: string | null };
}

export interface Cuadrilla {
  id: string;
  nombre: string;
  activo: boolean;
  miembros: CuadrillaMiembro[];
}

/** Renglón de personal en la hoja operativa. */
export interface PersonalHsaRow {
  nombre: string;
  hora?: string;
  rol?: string;
}

export interface Availability {
  fecha: string;
  spaces: SpaceAvailability[];
  blocked: boolean;
  capillaEventos: CapillaEvento[];
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

export interface FiniquitoFicha {
  venceISO: string;
  pagado: boolean;
  pendiente: boolean;
  restante: number;
  planPendiente: boolean;
}

export interface HojaFicha {
  nombreFestejado: string | null;
  relacionCliente: string | null;
  horaMisa: string | null;
  fotografia: boolean;
  banquetero: string | null;
  banqueteroPaqHsa: boolean;
  estrado: string | null;
  pista: string | null;
  personalHsa: string | null;
  personalSeguridadHora: string | null;
  personalSeguridadElementos: number | null;
  limpiezaNocturna: boolean;
  habitacion: string | null;
  seQuedaEquipo: string | null;
  maniobras: boolean;
  anotaciones: string | null;
}

export interface FichaSemana {
  quoteId: string;
  cliente: string;
  evento: string;
  espacio: string;
  fechaEventoISO: string;
  semaforo: Semaforo;
  faltantes: string[];
  invitados: number;
  horasEvento: number | null;
  usaCapilla: boolean;
  capillaHorario: string | null;
  costoHoraExtra: number;
  horaInicio: string | null;
  horaTermino: string | null;
  horarioCivil: string | null;
  hoja: HojaFicha;
  finiquito: FiniquitoFicha;
}

export interface DashboardData {
  kpis: { eventosMes: number };
  fichasSemana: FichaSemana[];
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
