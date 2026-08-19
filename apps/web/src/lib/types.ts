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

// Los parámetros de precio ya no son un singleton global: son los del CATÁLOGO
// ACTIVO (PriceList). `nombre` va aquí para que la pantalla diga cuál está
// editando — cambiarlos afecta lo que se cotice de aquí en adelante, nunca lo ya
// cotizado, porque cada cotización recalcula contra el catálogo que fijó.
/**
 * Un catálogo versionado tal como lo lista `GET /api/admin/price-lists`: el
 * año completo de precios (renta, servicios, alimentos) más sus parámetros.
 *
 * Los conteos vienen aplanados desde el `_count` de Prisma. `cotizaciones` es
 * el dato que dice si un catálogo se puede tocar sin represiar a nadie.
 */
export interface PriceList {
  id: string;
  nombre: string;
  anio: number;
  vigencia: string | null;
  activa: boolean;
  createdAt: string;
  ivaRate: number;
  extraHourRate: number;
  foodDiscountRate: number;
  capillaSabado: number;
  cotizaciones: number;
  renta: number;
  servicios: number;
  paquetes: number;
  /**
   * Precio del DJ por hora extra, por tipo de evento. Un tipo que no lo ofrece
   * simplemente NO viene en la lista (hoy: graduación, renta y team building).
   */
  dj: { eventTypeId: string; eventType: string; price: number }[];
}

/**
 * Un renglón de la matriz de renta, tal como lo devuelve
 * `GET /api/admin/price-lists/:id/contenido`.
 *
 * `id` es el de `RentalPrice` y es lo único con lo que se puede hacer
 * `PATCH …/rentas`. `min`/`max` van de solo lectura: los rangos de invitados no
 * se agregan ni se quitan —un hueco hace que el motor lance "no tiene rango de
 * renta para N invitados" meses después—, solo se editan los cuatro precios.
 */
export interface RentaRenglon {
  id: string;
  spaceId: string;
  espacio: string;
  /** `dia` = renta por tipo de día · `plano` = renta plana (Team Building). */
  tipo: string;
  min: number;
  max: number | null;
  viernes: number;
  viernesEspecial: number;
  sabado: number;
  domAJue: number;
}

export interface PaqueteCatalogo {
  id: string;
  nombre: string;
  eventTypeId: string;
  ivaIncluido: boolean;
  incluye: string | null;
  brackets: FoodPackageBracket[];
}

/** Todo lo editable de un catálogo, con ids. Solo admin. */
export interface CatalogoContenido {
  priceList: {
    id: string;
    nombre: string;
    anio: number;
    activa: boolean;
    ivaRate: number;
    extraHourRate: number;
    foodDiscountRate: number;
    capillaSabado: number;
  };
  renta: RentaRenglon[];
  servicios: AddOn[];
  paquetes: PaqueteCatalogo[];
  /** Un renglón por tipo de evento que SÍ ofrece DJ por hora extra. */
  dj: { eventTypeId: string; price: number }[];
  eventTypes: { id: string; nombre: string; slug: string }[];
}

/**
 * Cuántas cotizaciones puede represiar editar un catálogo, por estatus.
 *
 * No es una advertencia de que algo vaya a cambiar solo: los totales guardados
 * quedan congelados. Mide el riesgo de que alguien REEDITE una de ellas después,
 * que es cuando se recalcula contra el catálogo.
 */
export interface ImpactoCatalogo {
  priceListId: string;
  nombre: string;
  total: number;
  /** `formalizada` + `complementada` + `liquidada`: las que ya tienen dinero encima. */
  comprometidas: number;
  porEstatus: Partial<Record<QuoteStatus, number>>;
}

/** Un renglón de la bitácora del catálogo. */
export interface CambioCatalogo {
  id: string;
  tipo: 'renta' | 'servicio' | 'paquete' | 'dj' | 'parametros';
  descripcion: string;
  /** Cuántas cotizaciones había casadas al catálogo AL MOMENTO del cambio. */
  cotizacionesEnRiesgo: number;
  createdAt: string;
  actor?: { id: string; nombre: string } | null;
  meta?: { impacto?: { total: number; comprometidas: number } } | null;
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

/**
 * Servicio suelto de UN evento, fuera del catálogo. Ej.: el proveedor de comida
 * cobra $200 más por persona por cambio de menú, solo para este evento. El monto
 * SIEMPRE trae IVA incluido: lo teclado es lo final.
 */
export interface QuoteExtraInput {
  nombre: string;
  kind: 'fijo' | 'porPersona' | 'porUnidad';
  monto: number;
  cantidad: number;
}

export interface Quote {
  id: string;
  clientId: string;
  client?: Client;
  eventTypeId: string;
  eventType?: { id: string; nombre: string; slug: string };
  /**
   * Catálogo al que la cotización está casada. Manda al recalcular: reeditar una
   * de 2027 usa precios de 2027 aunque el catálogo activo ya sea 2028.
   */
  priceListId: string;
  priceList?: { id: string; nombre: string; anio: number } | null;
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
  /** Servicios sueltos de ESTE evento, fuera del catálogo (monto con IVA incluido). */
  extras?: QuoteExtraInput[];
  /** Descuento de cortesía, en % sobre la renta. `null` = sin descuento. */
  descuentoPct?: number | null;
  descuentoMotivo?: string | null;
  breakdown: QuoteBreakdown;
  total: number;
  rentaTotal: number;
  status: QuoteStatus;
  /** Código de evento (`17ENE-CBOLADO-CUPULA`). Es la identidad legible del
   *  evento: se congela al formalizar y se imprime donde alguien la va a copiar.
   *  `null` solo en cotizaciones que el backfill todavía no alcanzó. */
  codigo?: string | null;
  publicToken: string;
  createdAt: string;
  deletedAt?: string | null;
  createdBy?: { id: string; nombre: string } | null;
  desfase?: boolean;
}

export type PaymentConcept = 'anticipo' | 'complemento' | 'aCuenta' | 'finiquito';

export interface Payment {
  id: string;
  folio: number;
  monto: number;
  metodo: 'efectivo' | 'transferencia' | 'tarjeta';
  /**
   * El concepto EFECTIVO: se deduce de dónde deja el acumulado contra los hitos
   * del plan, no de lo que se teclea. Se reclasifica cuando cambia el acumulado
   * (registrar o anular un pago mueve a los posteriores).
   */
  concepto: PaymentConcept;
  /** Lo que alguien capturó a mano para discrepar. `null` = nadie discrepó. */
  conceptoManual?: PaymentConcept | null;
  fecha: string;
  referencia: string | null;
  comprobanteKey: string | null;
  anuladoAt: string | null;
  motivoAnulacion: string | null;
  // Candado de facturación: el servidor lo calcula al vuelo con el calendario.
  facturable?: boolean;
  motivoFactura?: string | null;
  facturadoAt?: string | null;
  /** Folio fiscal del CFDI, si se capturó al sellar el pago. */
  facturaUuid?: string | null;
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

/** Un renglón del complemento: `pct × rentaBase == monto`, exacto. */
export interface ComplementoPorEspacio {
  spaceId: string;
  rentaBase: number;
  pct: number;
  monto: number;
}

export interface Milestone {
  key: 'apartar' | 'complemento' | 'finiquito';
  label: string;
  objetivo: number;
  cubierto: number;
  restante: number;
  completo: boolean;
  venceISO: string | null;
  /** Solo el complemento: qué aporta cada salón. */
  desglose?: ComplementoPorEspacio[];
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
  // Debe seguir a `LogTipo` de `apps/api/src/quotes/activityLog.ts`. La bitácora
  // se pinta con `descripcion`, así que un valor de más no rompe la pantalla,
  // pero un tipo desalineado sí engaña a quien filtre por él.
  tipo:
    | 'creada'
    | 'estatus'
    | 'pago'
    | 'pagoAnulado'
    | 'edicion'
    | 'eliminada'
    | 'restaurada'
    | 'factura'
    | 'fiscal'
    | 'catalogo';
  descripcion: string;
  createdAt: string;
  actor?: { nombre: string } | null;
}

export interface QuoteDetail {
  quote: Quote;
  estadoCuenta: EstadoCuenta;
  payments: Payment[];
  /** `editable: false` cuando ya se emitió una factura con estos datos. */
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

/**
 * Cotización viva cuya fecha y espacio ya fueron apartados por otra.
 * Se calcula al vuelo en el servidor: no hay tabla ni "marcar como leído".
 */
export interface Desplazada {
  id: string;
  clienteNombre: string;
  fechaEvento: string;
  spaceIds: string[];
  bloqueadaPor: { id: string; clienteNombre: string };
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
