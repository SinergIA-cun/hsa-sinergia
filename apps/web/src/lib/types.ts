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

/**
 * Los cuatro estatus vivos. `enviada`, `aceptada` y `vencida` se retiraron el
 * 13-ago-2026 (punto 8). Debe seguir a `QUOTE_STATUSES` de la API.
 */
export const QUOTE_STATUSES = ['borrador', 'formalizada', 'complementada', 'liquidada'] as const;
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
  /** El banquetero que compró el evento. Con banquetero, ÉL es el cliente de la
   *  hacienda: firma él y se le factura a él. */
  banqueteroId?: string | null;
  banquetero?: { id: string; nombre: string; telefono: string | null } | null;
  /** El cliente FINAL. Dato operativo: va en la hoja operativa, NO en el contrato. */
  festejado?: string | null;
  festejadoTelefono?: string | null;
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

/** Debe seguir al enum `PaymentMethod` de Prisma. */
export type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta';

export interface Payment {
  id: string;
  folio: number;
  monto: number;
  metodo: PaymentMethod;
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

/**
 * Un apartado de banquetero que bloquea el espacio.
 *
 * Viene en su propia lista y NO dentro de `quotes` porque no es una cotización:
 * no tiene cliente, ni total, ni estatus. Sin mirarla, un espacio bloqueado solo
 * por un apartado se pinta como "comprometido" sin poder decir por quién.
 */
export interface ApartadoBloqueo {
  apartadoId: string;
  banquetero: string;
  venceISO: string;
  deposito: number;
}

export interface SpaceAvailability {
  spaceId: string;
  nombre: string;
  level: AvailabilityLevel;
  counts: {
    cotizaciones: number;
    formalizadas: number;
    complementadas: number;
    liquidadas: number;
    apartados: number;
  };
  quotes: { id: string; cliente: string; status: string }[];
  apartados: ApartadoBloqueo[];
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

// --- Cuenta corriente del banquetero (Plan H) ---

/**
 * Un pago por evento que salió de un depósito. Es un `Payment` de verdad, con su
 * folio de recibo: por eso el estado de cuenta, los hitos del plan y el candado
 * de facturación siguen funcionando sin enterarse del depósito madre.
 */
export interface AsignacionDeposito {
  id: string;
  quoteId: string;
  monto: number;
  folio: number;
  fecha: string;
  concepto: PaymentConcept;
  anuladoAt: string | null;
  motivoAnulacion: string | null;
  quote: { id: string; codigo: string | null; client: { nombre: string } | null } | null;
}

/** Un depósito del banquetero, con su reparto y lo que sigue sin destino. */
export interface DepositoBanquetero {
  id: string;
  banqueteroId: string;
  monto: number;
  metodo: PaymentMethod;
  /** Cuándo se RECIBIÓ. Es la fecha que heredan los pagos de sus asignaciones. */
  fecha: string;
  referencia: string | null;
  comprobanteKey: string | null;
  comprobanteMime: string | null;
  anuladoAt: string | null;
  motivoAnulacion: string | null;
  createdAt: string;
  asignaciones: AsignacionDeposito[];
  /** `monto − Σ asignaciones vivas`. Dinero de la hacienda sin destino. */
  saldoSinAsignar: number;
}

/** Una fecha apartada sin precio, tal como la devuelve la API con sus derivados. */
export interface ApartadoFecha {
  id: string;
  banqueteroId: string;
  fechaEvento: string;
  spaceIds: string[];
  priceListId: string | null;
  deposito: number;
  depositoMetodo: PaymentMethod | null;
  depositoFecha: string | null;
  vence: string;
  nota: string | null;
  quoteId: string | null;
  canceladoAt: string | null;
  motivoCancelacion: string | null;
  createdAt: string;
  banquetero?: { id: string; nombre: string; telefono: string | null };
  priceList?: { id: string; nombre: string; anio: number } | null;
  quote?: { id: string; codigo: string | null; total: number; status: QuoteStatus } | null;
  /** Sigue bloqueando su fecha: ni cancelado, ni convertido, ni vencido. */
  vivo: boolean;
  /** Se le pasó el vencimiento sin convertirse: ya no bloquea nada. */
  vencido: boolean;
}

export interface EventoBanquetero {
  quoteId: string;
  codigo: string | null;
  fechaEventoISO: string;
  status: QuoteStatus;
  cliente: string | null;
  festejado: string | null;
  festejadoTelefono: string | null;
  catalogo: string | null;
  total: number;
  rentaTotal: number;
  pagado: number;
  saldo: number;
  planPendiente: boolean;
}

export interface TotalesBanquetero {
  eventos: number;
  /** Solo de las cotizaciones: un apartado no tiene total. */
  rentaTotal: number;
  pagado: number;
  saldo: number;
  depositado: number;
  saldoSinAsignar: number;
  apartadosVivos: number;
  apartadosPorVencer: number;
}

export interface EstadoCuentaBanquetero {
  banquetero: {
    id: string;
    nombre: string;
    telefono: string | null;
    activo: boolean;
    publicToken: string;
  };
  eventos: EventoBanquetero[];
  depositos: DepositoBanquetero[];
  apartados: ApartadoFecha[];
  apartadosPorVencer: ApartadoFecha[];
  totales: TotalesBanquetero;
}

/**
 * La proyección del enlace de solo lectura. Es un objeto DISTINTO al interno a
 * propósito: no trae ids, ni llaves de comprobante, ni motivos de anulación, ni
 * quién registró cada movimiento.
 */
export interface EstadoCuentaPublico {
  banquetero: { nombre: string; telefono: string | null };
  eventos: {
    codigo: string | null;
    fechaEventoISO: string;
    status: QuoteStatus;
    festejado: string | null;
    total: number;
    rentaTotal: number;
    pagado: number;
    saldo: number;
  }[];
  depositos: {
    fechaISO: string;
    monto: number;
    metodo: PaymentMethod;
    referencia: string | null;
    saldoSinAsignar: number;
    asignaciones: { folio: number; monto: number; codigo: string | null }[];
  }[];
  apartados: {
    fechaEventoISO: string;
    spaceIds: string[];
    deposito: number;
    venceISO: string;
    catalogo: string | null;
  }[];
  totales: TotalesBanquetero;
}

/**
 * El renglón de `GET /api/banqueteros/resumen`: la cuenta de todos en una
 * consulta. Lo consumen la lista de admin y el tablero, y **no** filtra por
 * pertenencia: el saldo de una contraparte es uno solo.
 */
export interface ResumenBanquetero {
  banqueteroId: string;
  nombre: string;
  telefono: string | null;
  activo: boolean;
  publicToken: string;
  eventos: number;
  depositado: number;
  saldoSinAsignar: number;
  apartadosVivos: number;
  apartadosPorVencer: number;
  proximoVencimientoISO: string | null;
}

/** Un apartado vivo sin convertir, con su urgencia ya calculada por el servidor. */
export interface ApartadoPendiente {
  apartadoId: string;
  banqueteroId: string;
  banquetero: string;
  fechaEventoISO: string;
  venceISO: string;
  diasParaVencer: number;
  deposito: number;
  spaceIds: string[];
  catalogo: string | null;
  nota: string | null;
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
 * Una fecha apartada, en la agenda.
 *
 * Llega en su PROPIA lista y no dentro de `events`: `AgendaEvent` exige
 * `quoteId` y un apartado no tiene cotización, así que meterlo ahí rompería en
 * runtime el arrastre y el aviso de empalmes. La agenda es quien lo pinta
 * distinto.
 */
export interface AgendaApartado {
  apartadoId: string;
  banqueteroId: string;
  banquetero: string;
  fechaEvento: string;
  spaceIds: string[];
  venceISO: string;
  deposito: number;
  nota: string | null;
}

export interface AgendaResponse {
  events: AgendaEvent[];
  apartados: AgendaApartado[];
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

/**
 * Un evento que YA PASÓ y sigue debiendo.
 *
 * Por la regla del negocio —"no hay forma de hacer el evento si no está
 * pagado"— no debería existir ninguno. Si existe, o no se capturó un pago o el
 * evento no se hizo.
 */
export interface EventoPasadoSinLiquidar {
  quoteId: string;
  cliente: string;
  evento: string;
  espacio: string;
  fechaEventoISO: string;
  status: QuoteStatus;
  restante: number;
  diasDesdeEvento: number;
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
  pasadosSinLiquidar: EventoPasadoSinLiquidar[];
  /** La cartera de banqueteros. GLOBAL: no filtrada por pertenencia. */
  banqueteros: {
    totalSinAsignar: number;
    saldos: ResumenBanquetero[];
    apartados: ApartadoPendiente[];
    porVencer: number;
  };
}

// --- Bitácora forense (auditoría a nivel base de datos) ---

/**
 * De dónde salió un cambio.
 *
 * - `persona`: alguien con sesión, desde la aplicación.
 * - `sistema`: nuestro propio código sin persona detrás (migraciones, backfills).
 * - `externo`: **otro cliente de base de datos**. Ésta es la señal que importa.
 */
export type OrigenAuditoria = 'persona' | 'sistema' | 'externo';

/** Un cambio visto por los triggers de Postgres. */
export interface RenglonAuditoria {
  id: string;
  tabla: string;
  operacion: 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE';
  registroId: string | null;
  actorId: string | null;
  actorNombre: string | null;
  origen: OrigenAuditoria;
  usuarioDb: string;
  aplicacion: string | null;
  direccionIp: string | null;
  createdAt: string;
  /** Campos que cambiaron (solo en UPDATE). */
  campos: string[];
}

export interface DetalleAuditoria extends RenglonAuditoria {
  txid: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
}

export interface PaginaAuditoria {
  filas: RenglonAuditoria[];
  siguienteCursor: string | null;
  /** Cambios de los últimos 30 días que entraron por fuera de la aplicación. */
  externosRecientes: number;
  tablas: string[];
}

// --- Histórico de eventos ---

/** Un pago tal como quedó en la foto. */
export interface PagoFoto {
  folio: number;
  monto: number;
  metodo: string;
  concepto: string;
  fechaISO: string;
  referencia: string | null;
  registradoPor: string | null;
  facturado: boolean;
  facturaUuid: string | null;
  anulado: boolean;
  motivoAnulacion: string | null;
}

/**
 * Lo que sucedió ese día, resuelto y por NOMBRE.
 *
 * Se lee sola: no depende de los espacios, del catálogo ni del cliente vivos.
 */
export interface FotoEvento {
  tomadaEnISO: string;
  codigo: string | null;
  fechaEventoISO: string;
  status: string;
  seRealizo: boolean;
  liquidado: boolean;
  cliente: {
    nombre: string;
    telefono: string | null;
    correo: string | null;
    empresa: string | null;
    referencia: number | null;
    rfc: string | null;
    razonSocial: string | null;
    regimenFiscal: string | null;
    cpFiscal: string | null;
    usoCfdi: string | null;
    correoFacturacion: string | null;
    requiereFactura: boolean;
  };
  banquetero: string | null;
  festejado: string | null;
  festejadoTelefono: string | null;
  vendedor: string | null;
  evento: {
    tipo: string;
    espacios: string[];
    catalogo: string;
    invitados: number;
    horasEvento: number | null;
    horasExtra: number;
    usaCapilla: boolean;
    capillaHorario: string | null;
    esCortesia: boolean;
    descuentoPct: number | null;
    descuentoMotivo: string | null;
    usaDjHoraExtra: boolean;
    horaInicio: string | null;
    horaTermino: string | null;
    horarioCivil: string | null;
  };
  desglose: QuoteBreakdown | null;
  /** `saldoRenta`: en esta aplicación el estado de cuenta se calcula sobre la RENTA. */
  totales: { total: number; rentaTotal: number; pagado: number; saldoRenta: number };
  pagos: PagoFoto[];
  operativa: Record<string, unknown> | null;
}

export interface RenglonHistorico {
  id: string;
  quoteId: string;
  version: number;
  versiones: number;
  fechaEventoISO: string;
  codigo: string | null;
  cliente: string;
  banquetero: string | null;
  eventoTipo: string;
  espacios: string[];
  total: number;
  pagado: number;
  saldo: number;
  seRealizo: boolean;
  liquidado: boolean;
}

export interface PaginaHistorico {
  filas: RenglonHistorico[];
  total: number;
  hayMas: boolean;
  anios: number[];
}

export interface DetalleHistorico {
  id: string;
  quoteId: string;
  version: number;
  motivo: string;
  tomadaEnISO: string;
  foto: FotoEvento;
  versiones: { id: string; version: number; motivo: string; tomadaEnISO: string }[];
}

// --- "No se puede borrar: lo usan estos contratos" ---

/** Un contrato que impide borrar algo, con lo justo para poder abrirlo. */
export interface ContratoQueUsa {
  id: string;
  codigo: string | null;
  cliente: string;
  fechaEventoISO: string;
  status: string;
  /** Está en la papelera: no aparece en ninguna lista, y por eso hay que decirlo. */
  enPapelera: boolean;
}

export interface UsoEnContratos {
  total: number;
  /** Los primeros; `total` dice cuántos son en realidad. */
  muestra: ContratoQueUsa[];
}
