import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import {
  codigoEvento,
  computeQuote,
  quoteSelectionSchema,
  estadoFacturaPago,
  datosFiscalesEditables,
  hoyCivilMexico,
  motivoObligatorio,
  prorratearRenta,
  type QuoteExtra,
  type QuoteSelection,
} from '@hsa/shared';
import { loadCatalog } from '../catalog/loader.js';
import { getAvailability } from '../availability/service.js';
import { logActivity } from './activityLog.js';
import { computeEstadoCuenta, esUpgrade, type EstadoCuenta, type SpaceRuleWithRent } from './estadoCuenta.js';

export interface Actor {
  id: string;
  role: 'ventas' | 'admin';
}

/**
 * Los cuatro estatus vivos. `enviada`, `aceptada` y `vencida` se retiraron el
 * 13-ago-2026 (punto 8): nadie los movía a mano y `vencida` era además el único
 * mecanismo automático que limpiaba la agenda. Con él se fue `expireStaleQuotes`.
 */
export const QUOTE_STATUSES = ['borrador', 'formalizada', 'complementada', 'liquidada'] as const;

const clientSchema = z.object({
  nombre: z.string().min(1),
  telefono: z.string().optional(),
  correo: z.string().email().optional(),
  empresa: z.string().optional(),
  // Datos fiscales (CFDI 4.0). Se validan de forma laxa aquí —un cliente puede
  // guardarse a medias mientras junta los papeles— y la lista de requisitos de
  // @hsa/shared es la que dice si ya se le puede facturar.
  //
  // `nullish` y no `optional`: null es un valor legítimo ("este cliente no tiene
  // RFC") y es como se borra un dato mal capturado. Omitir el campo deja el valor
  // anterior intacto; mandarlo en null lo limpia.
  rfc: z.string().max(13).nullish(),
  razonSocial: z.string().max(200).nullish(),
  regimenFiscal: z.string().max(3).nullish(),
  cpFiscal: z.string().max(5).nullish(),
  usoCfdi: z.string().max(4).nullish(),
  correoFacturacion: z.string().max(200).nullish(),
});

/**
 * Los tres campos del desplegable "¿Para quién es este evento?".
 *
 * Con banquetero, ÉL es el cliente de la hacienda: firma él y se le factura a él
 * (decisión del dueño). El festejado es el cliente FINAL y es dato operativo: va
 * en la hoja operativa y **no** en el contrato.
 *
 * `nullish` y no `optional`: null es como se limpian —cambiar de banquetero a
 * cliente directo tiene que poder borrar los tres.
 */
const paraQuienSchema = {
  banqueteroId: z.string().nullish(),
  festejado: z.string().max(120).nullish(),
  festejadoTelefono: z.string().max(40).nullish(),
};

export const createQuoteSchema = quoteSelectionSchema
  .extend({
    eventTypeId: z.string(),
    horasEvento: z.number().int().positive().optional(),
    esCortesia: z.boolean().default(false),
    requiereFactura: z.boolean().default(false),
    capillaHorario: z.string().max(20).nullable().optional(),
    clientId: z.string().optional(),
    client: clientSchema.optional(),
    ...paraQuienSchema,
  })
  .refine((d) => Boolean(d.clientId ?? d.client), {
    message: 'Se requiere clientId o datos de client',
  })
  // El motivo del descuento es obligatorio si hay descuento. Va aquí y no en
  // `quoteSelectionSchema` porque `.refine()` devuelve un ZodEffects sin `.extend()`.
  .refine(motivoObligatorio.check, motivoObligatorio.opts);

export const updateQuoteSchema = quoteSelectionSchema
  .extend({
    eventTypeId: z.string(),
    horasEvento: z.number().int().positive().nullable().optional(),
    esCortesia: z.boolean().default(false),
    requiereFactura: z.boolean().default(false),
    capillaHorario: z.string().max(20).nullable().optional(),
    client: clientSchema.optional(),
    ...paraQuienSchema,
  })
  .refine(motivoObligatorio.check, motivoObligatorio.opts);

export const statusSchema = z.object({ status: z.enum(QUOTE_STATUSES) });

/** Los seis campos del cliente que congela el candado de facturación. */
const CAMPOS_FISCALES = ['rfc', 'razonSocial', 'regimenFiscal', 'cpFiscal', 'usoCfdi', 'correoFacturacion'] as const;

// El catálogo viaja con la cotización porque es el dato que explica por qué dos
// cotizaciones de fechas parecidas tienen precios distintos. Sin él, la interfaz
// solo puede enseñar un cuid, que no le dice nada a nadie.
const includeRels = {
  client: true,
  eventType: true,
  createdBy: { select: { id: true, nombre: true } },
  priceList: { select: { id: true, nombre: true, anio: true } },
  // El banquetero por nombre: el formulario tiene que poder reabrir la cotización
  // en modo "Banquetero" y enseñar de quién se trata sin otra consulta.
  banquetero: { select: { id: true, nombre: true, telefono: true } },
  // Los servicios sueltos del evento: no viven en el catálogo, así que la única
  // forma de recuperarlos para reeditar (y para recalcular) es leerlos de aquí.
  extras: { select: { nombre: true, kind: true, monto: true, cantidad: true } },
};

// Se permite editar el desglose incluso con compromiso de pago (formalizada/complementada);
// las ediciones en esos estatus quedan registradas en la bitácora de actividad.
const EDITABLE_STATUSES = new Set(['borrador', 'formalizada', 'complementada']);

// --- Código de evento ---------------------------------------------------------

/**
 * Estatus que ya APARTAN la fecha (hay compromiso de pago). Son los mismos que
 * bloquean el espacio en `availability/service.ts`, y son la frontera del
 * congelado: mientras la cotización no aparta, su código sigue a la fecha, al
 * cliente y al espacio; en cuanto aparta, queda fijo — a partir de ahí el código
 * ya está impreso en recibos y contratos, y regenerarlo cambiaría un
 * identificador que alguien ya copió.
 */
const STATUSES_QUE_APARTAN = new Set(['formalizada', 'complementada', 'liquidada']);

/** Un choque del índice único de `Quote.codigo` (y no de cualquier otro campo). */
function esColisionDeCodigo(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { code?: unknown; meta?: { target?: unknown } };
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const texto = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return texto.includes('codigo');
}

/**
 * El código libre a partir del base: `base`, o `base-2`, `base-3`… Dos eventos
 * del mismo cliente, la misma fecha y el mismo salón son raros pero posibles, y
 * no pueden romper el guardado.
 */
async function codigoLibre(db: PrismaClient, base: string, excludeQuoteId?: string): Promise<string> {
  const usados = await db.quote.findMany({
    where: {
      // El `-` del prefijo evita que `…-CUPULA` se coma a `…-CUPULANORTE`.
      OR: [{ codigo: base }, { codigo: { startsWith: `${base}-` } }],
      ...(excludeQuoteId ? { id: { not: excludeQuoteId } } : {}),
    },
    select: { codigo: true },
  });
  const tomados = new Set(usados.map((q) => q.codigo));
  if (!tomados.has(base)) return base;
  for (let n = 2; n <= 999; n++) {
    const candidato = `${base}-${n}`;
    if (!tomados.has(candidato)) return candidato;
  }
  throw new QuoteError(409, `No hay sufijo libre para el código de evento ${base}`);
}

/**
 * El código de evento de una cotización, ya resuelto contra la base.
 *
 * Los nombres de los espacios se leen EN EL ORDEN de `spaceIds`: `findMany` no
 * garantiza orden, y de eso depende cuál espacio manda en el código.
 */
async function generarCodigo(
  db: PrismaClient,
  datos: { fecha: string; cliente: string; spaceIds: string[] },
  excludeQuoteId?: string,
): Promise<string> {
  const spaces = await db.space.findMany({
    where: { id: { in: datos.spaceIds } },
    select: { id: true, nombre: true },
  });
  const nombreById = new Map(spaces.map((sp) => [sp.id, sp.nombre]));
  const espacios = datos.spaceIds.map((id) => nombreById.get(id) ?? '');
  const base = codigoEvento({ fechaISO: datos.fecha, cliente: datos.cliente, espacios });
  return codigoLibre(db, base, excludeQuoteId);
}

/**
 * Escribe la cotización con su código, reintentando si otra sesión se quedó con
 * el mismo entre el cálculo y la escritura. `codigoLibre` resuelve las colisiones
 * conocidas; esto cubre la carrera, que el índice único convertiría en un 500.
 */
async function conCodigoUnico<T>(
  db: PrismaClient,
  datos: { fecha: string; cliente: string; spaceIds: string[] },
  escribir: (codigo: string) => Promise<T>,
  excludeQuoteId?: string,
): Promise<T> {
  for (let intento = 0; ; intento++) {
    const codigo = await generarCodigo(db, datos, excludeQuoteId);
    try {
      return await escribir(codigo);
    } catch (e) {
      if (intento >= 3 || !esColisionDeCodigo(e)) throw e;
    }
  }
}

/**
 * Valida el banquetero elegido en el formulario. Un id que no existe se rechaza
 * con 400 y no con un error de FK de Postgres: el mensaje de Prisma no le dice
 * nada a nadie y la cotización quedaría a medias.
 */
async function assertBanquetero(db: PrismaClient, banqueteroId: string | null | undefined): Promise<void> {
  if (!banqueteroId) return;
  const existe = await db.banquetero.findUnique({ where: { id: banqueteroId }, select: { id: true } });
  if (!existe) throw new QuoteError(400, 'El banquetero elegido no existe.');
}

/**
 * El catálogo activo, o un 409 si no hay ninguno. Es el que se le fija a una
 * cotización nueva; de ahí en adelante manda el fijado, no el activo.
 */
async function catalogoActivo(db: PrismaClient): Promise<{ id: string }> {
  const activo = await db.priceList.findFirst({
    where: { activa: true },
    orderBy: { anio: 'desc' },
    select: { id: true },
  });
  if (!activo) throw new QuoteError(409, 'No hay catálogo activo: pide a un administrador que active uno.');
  return activo;
}

/** Calcula el desglose y enriquece las líneas de renta con el nombre del espacio. */
async function computeAndEnrich(db: PrismaClient, selection: QuoteSelection, priceListId?: string) {
  const catalog = await loadCatalog(db, priceListId ? { priceListId } : {});
  const breakdown = computeQuote(catalog, selection);
  const spaces = await db.space.findMany({ where: { id: { in: selection.spaceIds } } });
  const nameById = new Map(spaces.map((s) => [s.id, s.nombre]));
  const enriched = {
    ...breakdown,
    lines: breakdown.lines.map((l) => {
      // `spaceId` viene del motor: no hace falta interpretar el texto del concepto.
      // El `...l` conserva el spaceId en la línea guardada, que es de donde después
      // se recupera la renta de cada espacio para ponderar el plan de pagos.
      const nombre = l.spaceId ? nameById.get(l.spaceId) : undefined;
      return nombre ? { ...l, concepto: `Renta ${nombre}` } : l;
    }),
  };
  return { breakdown, enriched };
}

function toSelection(input: {
  fecha: string;
  invitados: number;
  spaceIds: string[];
  horasExtra: number;
  usaCapilla?: boolean;
  usaDjHoraExtra?: boolean;
  eventTypeId?: string;
  foodPackageId?: string;
  addOns: { addOnId: string; cantidad: number }[];
  extras?: QuoteExtra[];
  descuentoPct?: number | null;
  descuentoMotivo?: string | null;
}): QuoteSelection {
  return {
    fecha: input.fecha,
    invitados: input.invitados,
    spaceIds: input.spaceIds,
    horasExtra: input.horasExtra,
    usaCapilla: input.usaCapilla ?? false,
    usaDjHoraExtra: input.usaDjHoraExtra ?? false,
    eventTypeId: input.eventTypeId,
    foodPackageId: input.foodPackageId,
    addOns: input.addOns,
    extras: input.extras ?? [],
    descuentoPct: input.descuentoPct ?? undefined,
    descuentoMotivo: input.descuentoMotivo ?? undefined,
  };
}

// --- Reconstruir la selección de una cotización guardada ----------------------
//
// Tres caminos recalculan el desglose SIN que nadie vuelva a capturar el
// formulario: arrastrar la fecha en la agenda, mover de catálogo y la vista
// previa de ese movimiento. Los tres tienen que reconstruir la selección desde
// lo guardado, y armarla a mano campo por campo ya costó tres bugs de dinero en
// esta rama: cada campo nuevo del motor (los extras, el descuento de cortesía)
// se olvidaba en uno de los sitios y el recálculo lo borraba en silencio.
//
// Por eso hay UN solo armador. Y lo que lo hace a prueba de olvidos es el tipo:
// `SeleccionGuardadaInput` exige `extras`, `descuentoPct` y `descuentoMotivo`, y
// una cotización leída sin `include: SELECCION_INCLUDE` no los tiene, así que
// olvidarlos no compila en vez de perder dinero.

/**
 * Lo que hay que `include` al leer una cotización que se va a recalcular.
 *
 * Los extras no son columnas: si no se piden, `existing.extras` no existe y
 * `seleccionGuardada` no acepta el objeto. Ese es el candado.
 */
export const SELECCION_INCLUDE = {
  extras: { select: { nombre: true, kind: true, monto: true, cantidad: true } },
} as const;

/** Una cotización guardada, con TODO lo que el motor necesita para recalcular. */
interface SeleccionGuardadaInput {
  fechaEvento: Date;
  invitados: number;
  spaceIds: string[];
  horasExtra: number;
  usaCapilla: boolean;
  capillaHorario: string | null;
  esCortesia: boolean;
  usaDjHoraExtra: boolean;
  requiereFactura: boolean;
  eventTypeId: string;
  foodPackageId: string | null;
  horasEvento: number | null;
  addOns: Prisma.JsonValue;
  extras: QuoteExtra[];
  descuentoPct: number | null;
  descuentoMotivo: string | null;
  // No entran al precio, pero SÍ al guardado: `updateQuote` los reescribe, así que
  // dejarlos fuera de aquí haría que arrastrar la fecha borrara al banquetero y al
  // festejado — el mismo bug que este armador existe para prevenir.
  banqueteroId: string | null;
  festejado: string | null;
  festejadoTelefono: string | null;
}

/** La entrada de `updateQuoteSchema` equivalente a lo que la cotización TIENE hoy. */
export interface SeleccionGuardada {
  fecha: string;
  invitados: number;
  spaceIds: string[];
  horasExtra: number;
  usaCapilla: boolean;
  capillaHorario: string | null;
  esCortesia: boolean;
  usaDjHoraExtra: boolean;
  requiereFactura: boolean;
  eventTypeId: string;
  foodPackageId: string | undefined;
  horasEvento: number | null;
  addOns: { addOnId: string; cantidad: number }[];
  extras: QuoteExtra[];
  // `undefined` y no `null`: los esquemas de crear/editar declaran estos dos
  // `.optional()` (no `.nullish()`), y "sin descuento" se expresa omitiéndolos.
  // Mandar `null` los hace fallar la validación.
  descuentoPct: number | undefined;
  descuentoMotivo: string | undefined;
  banqueteroId: string | null;
  festejado: string | null;
  festejadoTelefono: string | null;
}

/**
 * Reconstruye la selección completa de una cotización guardada, tal como la
 * mandaría el formulario si alguien la abriera y le diera guardar sin cambiar
 * nada. Quien recalcula parte de aquí y solo sobrescribe lo que de verdad cambia
 * (la fecha al arrastrar; el paquete y los servicios retraducidos al mover de
 * catálogo).
 */
export function seleccionGuardada(q: SeleccionGuardadaInput): SeleccionGuardada {
  return {
    fecha: q.fechaEvento.toISOString().slice(0, 10),
    invitados: q.invitados,
    spaceIds: q.spaceIds,
    horasExtra: q.horasExtra,
    usaCapilla: q.usaCapilla,
    capillaHorario: q.capillaHorario,
    esCortesia: q.esCortesia,
    usaDjHoraExtra: q.usaDjHoraExtra,
    requiereFactura: q.requiereFactura,
    eventTypeId: q.eventTypeId,
    foodPackageId: q.foodPackageId ?? undefined,
    horasEvento: q.horasEvento,
    addOns: (q.addOns as unknown as { addOnId: string; cantidad: number }[] | null) ?? [],
    extras: q.extras,
    descuentoPct: q.descuentoPct ?? undefined,
    descuentoMotivo: q.descuentoMotivo ?? undefined,
    banqueteroId: q.banqueteroId,
    festejado: q.festejado,
    festejadoTelefono: q.festejadoTelefono,
  };
}

/** Ventas solo ve/edita lo suyo; admin todo. */
export function ownershipWhere(actor: Actor): Prisma.QuoteWhereInput {
  return actor.role === 'admin' ? {} : { createdById: actor.id };
}

/**
 * El espacio comprometido no se puede sobrevender. El navegador ya avisa antes de
 * guardar, pero la autoridad es el servidor: sin esto, una llamada directa a la
 * API —o dos personas de ventas guardando al mismo tiempo— pisan el compromiso.
 */
async function assertEspaciosDisponibles(
  db: PrismaClient,
  fecha: string,
  spaceIds: string[],
  excludeQuoteId?: string,
): Promise<void> {
  const disp = await getAvailability(db, fecha, spaceIds, excludeQuoteId);
  const ocupados = disp.spaces.filter((s) => s.level === 'bloqueada');
  if (ocupados.length > 0) {
    const nombres = ocupados.map((s) => s.nombre).join(', ');
    throw new QuoteError(409, `${nombres} no está disponible el ${fecha}: ya hay un evento comprometido.`);
  }
}

/**
 * Renta atribuida a cada espacio, con las horas extra y la capilla ya repartidas.
 *
 * Los renglones `Renta {spaceId}` del desglose son los únicos que traen `spaceId`;
 * horas extra y capilla entran a `rentaTotal` sin dueño. Se prorratean para que
 * la suma de las bases sea exactamente `rentaTotal` y el complemento no cambie.
 *
 * Las cotizaciones anteriores al campo `spaceId` no lo traen: su catálogo queda
 * en ceros y el prorrateo reparte en partes iguales, que para un solo espacio es
 * el monto completo.
 */
function rentaBasePorEspacio(breakdown: unknown, spaceIds: string[], rentaTotal: number): Map<string, number> {
  const lines = (breakdown as { lines?: { spaceId?: string; monto?: number }[] } | null)?.lines ?? [];
  const catalogo = new Map<string, number>();
  for (const id of spaceIds) catalogo.set(id, 0);
  for (const l of lines) {
    if (l.spaceId && typeof l.monto === 'number' && catalogo.has(l.spaceId)) {
      catalogo.set(l.spaceId, (catalogo.get(l.spaceId) ?? 0) + l.monto);
    }
  }
  return prorratearRenta(catalogo, rentaTotal);
}

/**
 * Reglas de pago listas para el motor, o `null` si falta la de algún espacio.
 *
 * Basta que UN espacio no tenga regla para que el plan quede pendiente: no se
 * puede cobrar un plan a medias. Cuatro espacios (Balcones, Pajaritos, Jardín
 * del Caballo, Capilla) todavía no tienen montos definidos.
 */
function armarReglas(
  reglas: { spaceId: string; anticipo: number; complementoPct: number; liquidarDiasAntes: number }[],
  spaceIds: string[],
  rentaBase: Map<string, number>,
): SpaceRuleWithRent[] | null {
  if (spaceIds.length === 0 || reglas.length !== spaceIds.length) return null;
  return reglas.map((r) => ({
    spaceId: r.spaceId,
    rule: { anticipo: r.anticipo, complementoPct: r.complementoPct, liquidarDiasAntes: r.liquidarDiasAntes },
    rentaBase: rentaBase.get(r.spaceId) ?? 0,
  }));
}

// El plan de pagos, el saldo y el finiquito se miden SOLO sobre la renta (lo que
// cobra HSA). Los alimentos se pagan directo al banquetero y no se rastrean aquí.
/** Carga las reglas de los espacios + pagos y arma el estado de cuenta (base: renta). */
export async function loadEstadoCuenta(db: PrismaClient, quote: {
  id: string; rentaTotal: number; fechaEvento: Date; status: string; spaceIds: string[]; breakdown: unknown;
}) {
  const [rules, payments, firstApartado] = await Promise.all([
    db.spacePaymentRule.findMany({ where: { spaceId: { in: quote.spaceIds } } }),
    db.payment.findMany({ where: { quoteId: quote.id }, orderBy: { fecha: 'asc' } }),
    db.activityLog.findFirst({
      // Primer momento en que el evento alcanzó el hito del anticipo. Se aceptan
      // ambos términos: 'formalizada' es el nombre actual y 'apartada' el que
      // quedó escrito en la bitácora de los eventos anteriores al renombrado.
      where: {
        quoteId: quote.id,
        tipo: 'estatus',
        OR: [{ descripcion: { contains: 'formalizada' } }, { descripcion: { contains: 'apartada' } }],
      },
      orderBy: { createdAt: 'asc' }, select: { createdAt: true },
    }),
  ]);

  const rentaBase = rentaBasePorEspacio(quote.breakdown, quote.spaceIds, quote.rentaTotal);
  const ec = computeEstadoCuenta({
    total: quote.rentaTotal,
    fechaEvento: quote.fechaEvento,
    status: quote.status,
    rules: armarReglas(rules, quote.spaceIds, rentaBase),
    payments: payments.map((p) => ({ monto: p.monto, anuladoAt: p.anuladoAt })),
    fechaApartado: firstApartado?.createdAt ?? null,
  });
  return { estadoCuenta: ec, payments };
}

export interface QuoteEC {
  id: string;
  rentaTotal: number;
  fechaEvento: Date;
  status: string;
  spaceIds: string[];
  breakdown: unknown;
}

/**
 * Estado de cuenta de varias cotizaciones en una sola tanda de consultas
 * (regla/pagos/apartado en bloque), para evitar N+1 en listas y paneles.
 */
export async function loadEstadoCuentaBulk(
  db: PrismaClient,
  quotes: QuoteEC[],
): Promise<Map<string, EstadoCuenta>> {
  const out = new Map<string, EstadoCuenta>();
  if (quotes.length === 0) return out;

  const quoteIds = quotes.map((q) => q.id);
  // Todos los espacios de todas las cotizaciones: un evento puede usar hasta 3.
  const spaceIds = [...new Set(quotes.flatMap((q) => q.spaceIds))];

  const [rules, payments, apartados] = await Promise.all([
    db.spacePaymentRule.findMany({ where: { spaceId: { in: spaceIds } } }),
    db.payment.findMany({ where: { quoteId: { in: quoteIds } } }),
    db.activityLog.findMany({
      // Ver la nota en loadEstadoCuenta: se aceptan el término nuevo y el legado.
      where: {
        quoteId: { in: quoteIds },
        tipo: 'estatus',
        OR: [{ descripcion: { contains: 'formalizada' } }, { descripcion: { contains: 'apartada' } }],
      },
      orderBy: { createdAt: 'asc' },
      select: { quoteId: true, createdAt: true },
    }),
  ]);

  const ruleBySpace = new Map(rules.map((r) => [r.spaceId, r]));
  const pagosByQuote = new Map<string, { monto: number; anuladoAt: Date | null }[]>();
  for (const p of payments) {
    const arr = pagosByQuote.get(p.quoteId) ?? [];
    arr.push({ monto: p.monto, anuladoAt: p.anuladoAt });
    pagosByQuote.set(p.quoteId, arr);
  }
  const apartadoByQuote = new Map<string, Date>();
  for (const a of apartados) {
    if (!apartadoByQuote.has(a.quoteId)) apartadoByQuote.set(a.quoteId, a.createdAt);
  }

  for (const q of quotes) {
    const rentaBase = rentaBasePorEspacio(q.breakdown, q.spaceIds, q.rentaTotal);
    const reglas = q.spaceIds
      .map((id) => ruleBySpace.get(id))
      .filter((r): r is NonNullable<typeof r> => r != null);
    out.set(
      q.id,
      computeEstadoCuenta({
        total: q.rentaTotal,
        fechaEvento: q.fechaEvento,
        status: q.status,
        rules: armarReglas(reglas, q.spaceIds, rentaBase),
        payments: pagosByQuote.get(q.id) ?? [],
        fechaApartado: apartadoByQuote.get(q.id) ?? null,
      }),
    );
  }
  return out;
}

export interface CambioEstatus {
  quoteId: string;
  cliente: string;
  de: string;
  a: string;
  pagado: number;
}

/**
 * Reconcilia el estatus de las cotizaciones contra lo YA pagado.
 *
 * El auto-avance normal solo dispara al registrar un pago. Las cotizaciones que
 * pagaron antes de que existieran las reglas de pago (o cuyo estatus se movió a
 * mano) se quedan atrás. Esto las pone al día: nunca baja un estatus, solo
 * avanza cuando el acumulado ya cruzó un hito.
 */
export async function reconcileStatuses(
  db: PrismaClient,
  opts: { dryRun?: boolean; actorId?: string } = {},
): Promise<CambioEstatus[]> {
  const quotes = await db.quote.findMany({
    where: { deletedAt: null, payments: { some: { anuladoAt: null } } },
    select: {
      id: true,
      status: true,
      rentaTotal: true,
      fechaEvento: true,
      spaceIds: true,
      // El desglose lleva la renta de cada espacio, que pondera el complemento.
      breakdown: true,
      client: { select: { nombre: true } },
    },
  });
  if (quotes.length === 0) return [];

  const estados = await loadEstadoCuentaBulk(db, quotes);
  const cambios: CambioEstatus[] = [];

  for (const q of quotes) {
    const ec = estados.get(q.id);
    if (!ec || !esUpgrade(q.status, ec.sugerido)) continue;

    const cambio: CambioEstatus = {
      quoteId: q.id,
      cliente: q.client?.nombre ?? 'Cliente',
      de: q.status,
      a: ec.sugerido!,
      pagado: ec.pagado,
    };
    cambios.push(cambio);

    if (!opts.dryRun) {
      await db.quote.update({ where: { id: q.id }, data: { status: ec.sugerido! } });
      await logActivity(db, {
        quoteId: q.id,
        tipo: 'estatus',
        descripcion: `Estatus: ${q.status} → ${ec.sugerido} (reconciliación por pagos)`,
        meta: { de: q.status, a: ec.sugerido, auto: true, reconciliacion: true, pagado: ec.pagado },
        actorId: opts.actorId,
      });
    }
  }
  return cambios;
}

export async function createQuote(db: PrismaClient, rawInput: unknown, actor: Actor) {
  const input = createQuoteSchema.parse(rawInput);
  // Antes de CUALQUIER escritura (incluida la del cliente): una cotización
  // rechazada no debe dejar un cliente huérfano en la base.
  await assertEspaciosDisponibles(db, input.fecha, input.spaceIds);
  await assertBanquetero(db, input.banqueteroId);
  // El catálogo se fija AQUÍ y queda casado a la cotización: reeditarla más
  // adelante recalcula contra este, no contra el que esté activo ese día.
  const catalogo = await catalogoActivo(db);
  const { breakdown, enriched } = await computeAndEnrich(db, toSelection(input), catalogo.id);

  let clientId = input.clientId;
  if (!clientId && input.client) {
    const created = await db.client.create({ data: input.client });
    clientId = created.id;
  } else if (clientId && input.client) {
    // Cliente reutilizado: sus datos fiscales pueden venir capturados por
    // primera vez en ESTE evento (el que vuelve y hasta ahora pide factura).
    // Sin esto se perdían en silencio, que es justo lo que la tarjeta existe
    // para capturar. Nombre, teléfono y correo no divergen: editarlos en el
    // formulario desvincula al cliente, así que reescribirlos es un no-op.
    await db.client.update({ where: { id: clientId }, data: input.client });
  }

  // El nombre con el que se arma el código: el capturado si vino en la petición,
  // y si no el del cliente que se reutilizó.
  const nombreCliente =
    input.client?.nombre ??
    (await db.client.findUnique({ where: { id: clientId! }, select: { nombre: true } }))?.nombre ??
    '';

  const created = await conCodigoUnico(
    db,
    { fecha: input.fecha, cliente: nombreCliente, spaceIds: input.spaceIds },
    (codigo) =>
      db.quote.create({
        data: {
          codigo,
          clientId: clientId!,
          eventTypeId: input.eventTypeId,
          fechaEvento: new Date(`${input.fecha}T00:00:00.000Z`),
          horasEvento: input.horasEvento ?? null,
          invitados: input.invitados,
          spaceIds: input.spaceIds,
          horasExtra: input.horasExtra,
          usaCapilla: input.usaCapilla ?? false,
          capillaHorario: input.capillaHorario ?? null,
          esCortesia: input.esCortesia ?? false,
          requiereFactura: input.requiereFactura,
          usaDjHoraExtra: input.usaDjHoraExtra ?? false,
          foodPackageId: input.foodPackageId ?? null,
          addOns: input.addOns as unknown as Prisma.InputJsonValue,
          // Los extras se copian tal cual: nombre y monto, no un id de catálogo.
          extras: { create: input.extras },
          descuentoPct: input.descuentoPct ?? null,
          descuentoMotivo: input.descuentoMotivo ?? null,
          // Con banquetero, él es el cliente de la hacienda; el festejado es dato
          // operativo y no entra al contrato.
          banqueteroId: input.banqueteroId ?? null,
          festejado: input.festejado ?? null,
          festejadoTelefono: input.festejadoTelefono ?? null,
          breakdown: enriched as unknown as Prisma.InputJsonValue,
          total: Math.round(breakdown.total),
          rentaTotal: Math.round(breakdown.rentaTotal),
          publicToken: randomUUID().replace(/-/g, ''),
          vigenciaHasta: vigenciaDesde(new Date()),
          createdById: actor.id,
          priceListId: catalogo.id,
        },
        include: includeRels,
      }),
  );
  await logActivity(db, { quoteId: created.id, tipo: 'creada', descripcion: 'Cotización creada', actorId: actor.id });
  return created;
}

/**
 * Clona una cotización como nueva (mismo cliente/evento/figuras), en borrador
 * y con token propio. Ahorra recapturar; el vendedor ajusta la fecha después.
 * Copia el desglose tal cual; al reeditar y guardar se recalcula con precios vigentes.
 */
export async function duplicateQuote(db: PrismaClient, id: string, actor: Actor) {
  const src = await db.quote.findFirst({
    where: { id, ...ownershipWhere(actor) },
    // Los extras se copian con el desglose: si no viajaran, la copia mostraría un
    // total que incluye un servicio que la cotización nueva ya no tiene, y al
    // reeditarla el monto se caería sin que nadie lo decidiera.
    include: { ...SELECCION_INCLUDE, client: { select: { nombre: true } } },
  });
  if (!src) throw new QuoteError(404, 'Cotización no encontrada');

  // La copia NO hereda el código: es otro evento. Con el mismo cliente, fecha y
  // salón que el original, su base choca y le toca sufijo — que es justamente el
  // camino por el que la colisión aparece en la vida real.
  const created = await conCodigoUnico(
    db,
    {
      fecha: src.fechaEvento.toISOString().slice(0, 10),
      cliente: src.client?.nombre ?? '',
      spaceIds: src.spaceIds,
    },
    (codigo) =>
      db.quote.create({
        data: {
          codigo,
          clientId: src.clientId,
          eventTypeId: src.eventTypeId,
          fechaEvento: src.fechaEvento,
          horasEvento: src.horasEvento,
          invitados: src.invitados,
          spaceIds: src.spaceIds,
          horasExtra: src.horasExtra,
          usaCapilla: src.usaCapilla,
          capillaHorario: src.capillaHorario,
          usaDjHoraExtra: src.usaDjHoraExtra,
          foodPackageId: src.foodPackageId,
          addOns: src.addOns as unknown as Prisma.InputJsonValue,
          extras: { create: src.extras },
          descuentoPct: src.descuentoPct,
          descuentoMotivo: src.descuentoMotivo,
          // La copia es OTRO evento del mismo comprador: el banquetero y el
          // festejado viajan con ella (justo el caso del banquetero que compra
          // tres fechas y las duplica para no recapturar).
          banqueteroId: src.banqueteroId,
          festejado: src.festejado,
          festejadoTelefono: src.festejadoTelefono,
          breakdown: src.breakdown as unknown as Prisma.InputJsonValue,
          total: src.total,
          rentaTotal: src.rentaTotal,
          publicToken: randomUUID().replace(/-/g, ''),
          vigenciaHasta: vigenciaDesde(new Date()),
          createdById: actor.id,
          // La copia hereda el catálogo del original: copia el desglose tal cual,
          // así que tiene que poder recalcularse contra los MISMOS precios.
          priceListId: src.priceListId,
        },
        include: includeRels,
      }),
  );
  await logActivity(db, {
    quoteId: created.id,
    tipo: 'creada',
    descripcion: `Cotización creada (duplicada de ${src.id})`,
    meta: { duplicadaDe: src.id },
    actorId: actor.id,
  });
  return created;
}

export class QuoteError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Una cotización en la papelera es de solo lectura (evidencia de auditoría). */
export function assertNotTrashed(quote: { deletedAt: Date | null }): void {
  if (quote.deletedAt) {
    throw new QuoteError(409, 'La cotización está en la papelera (solo lectura); restáurala para modificarla');
  }
}

export async function updateQuote(db: PrismaClient, id: string, rawInput: unknown, actor: Actor) {
  const existing = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(existing);
  if (!EDITABLE_STATUSES.has(existing.status)) {
    throw new QuoteError(409, `No se puede editar una cotización en estatus "${existing.status}"`);
  }
  const input = updateQuoteSchema.parse(rawInput);
  // Se excluye a sí misma: editar sin mover fecha ni espacio no se auto-bloquea.
  await assertEspaciosDisponibles(db, input.fecha, input.spaceIds, id);
  await assertBanquetero(db, input.banqueteroId);
  // Con el catálogo que la cotización FIJÓ al crearse, nunca con el activo:
  // reeditar una cotización de 2027 debe usar precios de 2027 aunque el catálogo
  // vigente ya sea 2028. Sin esto, cambiarle el nombre al cliente la represia.
  const { breakdown, enriched } = await computeAndEnrich(
    db,
    toSelection(input),
    existing.priceListId,
  );

  let bitacoraFiscal: { campos: string[]; desbloqueoDeAdmin: boolean } | null = null;
  if (input.client) {
    // Los datos fiscales se congelan cuando ya salió un CFDI con ellos: cambiarlos
    // por debajo desalinea lo timbrado. Un admin sí puede corregirlos (típicamente
    // tras cancelar el CFDI) y el cambio queda en la bitácora.
    //
    // Se compara VALOR contra valor, y solo de las llaves presentes:
    //  · El formulario manda SIEMPRE los seis campos fiscales (ver
    //    `fiscalesParaGuardar` en el front). Bloquear por presencia haría imposible
    //    editar cualquier otra cosa del evento —invitados, horas extra— en cuanto
    //    se emite la primera factura.
    //  · `Object.hasOwn` y no `in`: `in` recorre la cadena de prototipos, así que
    //    un campo ausente que exista en `Object.prototype` se leería como enviado.
    //  · Omitir una llave significa "déjala como está" (así lo trata Prisma), no
    //    "ponla en null"; por eso la ausencia nunca cuenta como cambio.
    const clienteActual = await db.client.findUnique({ where: { id: existing.clientId } });
    const camposFiscalesCambiados = CAMPOS_FISCALES.filter(
      (campo) =>
        Object.hasOwn(input.client!, campo) &&
        (input.client![campo] ?? null) !== (clienteActual?.[campo] ?? null),
    );

    let congelado = false;
    if (camposFiscalesCambiados.length > 0) {
      const pagos = await db.payment.findMany({
        where: { quoteId: id },
        select: { fecha: true, facturadoAt: true, desbloqueoAt: true, anuladoAt: true },
      });
      const edicion = datosFiscalesEditables(pagos);
      congelado = !edicion.editable;
      if (congelado && actor.role !== 'admin') {
        throw new QuoteError(409, edicion.motivo ?? 'Los datos fiscales ya no se pueden modificar.');
      }
      bitacoraFiscal = { campos: [...camposFiscalesCambiados], desbloqueoDeAdmin: congelado };
    }

    await db.client.update({ where: { id: existing.clientId }, data: input.client });
  }

  // El código se regenera mientras la cotización NO aparte la fecha: en borrador
  // sigue a la fecha, al cliente y al espacio. Con compromiso de pago queda
  // congelado —`codigo: undefined` deja la columna intacta—, porque a partir de
  // ahí ya está impreso en recibos y contratos. Y si por lo que sea la columna
  // viene vacía (cotización anterior al campo que se formalizó sin backfill), se
  // genera aunque ya aparte: un evento sin código no tiene identidad que romper.
  const debeRegenerar = !STATUSES_QUE_APARTAN.has(existing.status) || existing.codigo == null;
  const nombreCliente = debeRegenerar
    ? input.client?.nombre ??
      (await db.client.findUnique({ where: { id: existing.clientId }, select: { nombre: true } }))?.nombre ??
      ''
    : '';

  const escribir = (codigo: string | undefined) =>
    db.quote.update({
      where: { id },
      data: {
        codigo,
        eventTypeId: input.eventTypeId,
        fechaEvento: new Date(`${input.fecha}T00:00:00.000Z`),
        horasEvento: input.horasEvento ?? null,
        invitados: input.invitados,
        spaceIds: input.spaceIds,
        horasExtra: input.horasExtra,
        usaCapilla: input.usaCapilla ?? false,
        capillaHorario: input.capillaHorario ?? null,
        esCortesia: input.esCortesia ?? false,
        requiereFactura: input.requiereFactura,
        usaDjHoraExtra: input.usaDjHoraExtra ?? false,
        foodPackageId: input.foodPackageId ?? null,
        addOns: input.addOns as unknown as Prisma.InputJsonValue,
        // Se reemplazan en bloque, igual que los add-ons: el formulario manda la
        // lista completa, así que borrar y recrear es lo que refleja lo capturado.
        extras: { deleteMany: {}, create: input.extras },
        descuentoPct: input.descuentoPct ?? null,
        descuentoMotivo: input.descuentoMotivo ?? null,
        banqueteroId: input.banqueteroId ?? null,
        festejado: input.festejado ?? null,
        festejadoTelefono: input.festejadoTelefono ?? null,
        breakdown: enriched as unknown as Prisma.InputJsonValue,
        total: Math.round(breakdown.total),
        rentaTotal: Math.round(breakdown.rentaTotal),
      },
      include: includeRels,
    });

  const updated = debeRegenerar
    ? await conCodigoUnico(
        db,
        { fecha: input.fecha, cliente: nombreCliente, spaceIds: input.spaceIds },
        escribir,
        // Se excluye a sí misma: si el código base no cambió, la cotización se
        // quedaría chocando consigo misma y se auto-bumpearía a `-2` en cada
        // guardado, cambiando el identificador sin que nadie lo pidiera.
        id,
      )
    : await escribir(undefined);

  // Todo cambio de datos fiscales se registra, esté o no congelado el candado:
  // el RFC con el que se timbra es información que hay que poder auditar hacia
  // atrás. La marca de "desbloqueo de admin" señala los que rompieron el candado.
  if (bitacoraFiscal) {
    await logActivity(db, {
      quoteId: id,
      tipo: 'fiscal',
      descripcion: `Datos fiscales actualizados${bitacoraFiscal.desbloqueoDeAdmin ? ' (desbloqueo de admin)' : ''}: ${bitacoraFiscal.campos.join(', ')}`,
      meta: { campos: bitacoraFiscal.campos, desbloqueoDeAdmin: bitacoraFiscal.desbloqueoDeAdmin },
      actorId: actor.id,
    });
  }

  // Se registra CUALQUIER edición que cambie algo material, no solo las de eventos
  // con compromiso de pago: el BI necesita el historial completo de cambios de
  // salón y de tamaño de evento. Si no cambió nada, no se escribe: una bitácora
  // llena de ruido no sirve para auditar.
  const antes = {
    invitados: existing.invitados,
    espacios: [...existing.spaceIds].sort(),
    fecha: existing.fechaEvento.toISOString().slice(0, 10),
    total: existing.total,
    rentaTotal: existing.rentaTotal,
  };
  const despues = {
    invitados: updated.invitados,
    espacios: [...updated.spaceIds].sort(),
    fecha: updated.fechaEvento.toISOString().slice(0, 10),
    total: updated.total,
    rentaTotal: updated.rentaTotal,
  };
  if (JSON.stringify(antes) !== JSON.stringify(despues)) {
    await logActivity(db, {
      quoteId: id,
      tipo: 'edicion',
      descripcion: `Edición en ${existing.status}: total ${existing.total} → ${updated.total}`,
      meta: {
        invitadosAntes: antes.invitados, invitadosDespues: despues.invitados,
        espaciosAntes: existing.spaceIds, espaciosDespues: updated.spaceIds,
        fechaAntes: antes.fecha, fechaDespues: despues.fecha,
        totalAntes: antes.total, totalDespues: despues.total,
        rentaTotalAntes: antes.rentaTotal, rentaTotalDespues: despues.rentaTotal,
      },
      actorId: actor.id,
    });
  }

  return updated;
}

/**
 * Mueve un evento a otra fecha (arrastre en la agenda).
 *
 * Cambiar la fecha cambia el precio: la renta depende del tipo de día. Por eso
 * NO se escribe la fecha a secas — se reconstruye la selección actual con la
 * fecha nueva y se delega en `updateQuote`, que recalcula el desglose, valida
 * que el espacio esté libre en el destino y respeta ownership y estatus
 * editables (liquidada queda fuera por ese camino).
 *
 * La selección la arma `seleccionGuardada`, no este código: armarla a mano dejaba
 * fuera los extras y el descuento de cortesía, y el arrastre —que el dueño usa a
 * diario— borraba el descuento y represiaba el evento solo.
 */
export async function moveQuoteDate(db: PrismaClient, id: string, fecha: string, actor: Actor) {
  const existing = await db.quote.findFirst({
    where: { id, ...ownershipWhere(actor) },
    include: SELECCION_INCLUDE,
  });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(existing);
  if (!EDITABLE_STATUSES.has(existing.status)) {
    throw new QuoteError(409, `No se puede mover una cotización en estatus "${existing.status}"`);
  }

  const fechaAntes = existing.fechaEvento.toISOString().slice(0, 10);

  const actualizada = await updateQuote(
    db,
    id,
    // Lo único que cambia es la fecha; todo lo demás se recalcula con lo que la
    // cotización ya tenía.
    { ...seleccionGuardada(existing), fecha },
    actor,
  );

  await logActivity(db, {
    quoteId: id,
    tipo: 'edicion',
    descripcion: `Fecha: ${fechaAntes} → ${fecha} · total ${existing.total} → ${actualizada.total}`,
    meta: { fechaAntes, fechaDespues: fecha, totalAntes: existing.total, totalDespues: actualizada.total },
    actorId: actor.id,
  });

  return actualizada;
}

export const moverCatalogoSchema = z.object({ priceListId: z.string().min(1) });

/** Lo que la cotización guarda como selección de alimentos y servicios. */
type SeleccionCatalogo = { foodPackageId: string | null; addOns: { addOnId: string; cantidad: number }[] };

/**
 * Traduce el paquete y los servicios elegidos a los registros EQUIVALENTES del
 * catálogo destino.
 *
 * Clonar un catálogo crea filas nuevas con ids nuevos: el paquete "SUPREME" de
 * 2028 no es el mismo registro que el "SUPREME" de 2027. Mover la cotización sin
 * retraducir la dejaría irrecalculable —el motor lanza `Paquete de alimentos …
 * no existe`—, que es exactamente la clase de bug que este plan vino a matar.
 *
 * El casamiento es por nombre, que es lo que el clon conserva; el paquete lleva
 * además su tipo de evento porque el mismo nombre ("3 Tiempos") se repite entre
 * tipos. Si el destino no trae el equivalente, se aborta con 409 y se dice cuál
 * falta: mover borrando conceptos cobrados sería peor que no mover.
 */
async function traducirSeleccion(
  db: PrismaClient,
  quote: { foodPackageId: string | null; addOns: unknown; eventTypeId: string },
  destinoId: string,
): Promise<SeleccionCatalogo> {
  const addOns = (quote.addOns as unknown as { addOnId: string; cantidad: number }[] | null) ?? [];

  let foodPackageId: string | null = null;
  if (quote.foodPackageId) {
    const actual = await db.foodPackage.findUnique({ where: { id: quote.foodPackageId } });
    if (!actual) throw new QuoteError(409, 'El paquete de alimentos de la cotización ya no existe.');
    const equivalente = await db.foodPackage.findFirst({
      where: { priceListId: destinoId, nombre: actual.nombre, eventTypeId: actual.eventTypeId },
    });
    if (!equivalente) {
      throw new QuoteError(409, `El catálogo destino no tiene el paquete "${actual.nombre}".`);
    }
    foodPackageId = equivalente.id;
  }

  if (addOns.length === 0) return { foodPackageId, addOns: [] };

  const actuales = await db.addOn.findMany({ where: { id: { in: addOns.map((a) => a.addOnId) } } });
  const nombrePorId = new Map(actuales.map((a) => [a.id, a.nombre]));
  const destino = await db.addOn.findMany({ where: { priceListId: destinoId } });
  const idPorNombre = new Map(destino.map((a) => [a.nombre, a.id]));

  const traducidos = addOns.map((a) => {
    const nombre = nombrePorId.get(a.addOnId);
    if (!nombre) throw new QuoteError(409, 'Un servicio de la cotización ya no existe.');
    const id = idPorNombre.get(nombre);
    if (!id) throw new QuoteError(409, `El catálogo destino no tiene el servicio "${nombre}".`);
    return { addOnId: id, cantidad: a.cantidad };
  });

  return { foodPackageId, addOns: traducidos };
}

/**
 * Todo lo que hace falta para mover una cotización de catálogo, SIN escribir
 * nada: validaciones, traducción de la selección y el recálculo con el catálogo
 * destino.
 *
 * Existe separado para que la vista previa y el movimiento real corran
 * exactamente el mismo código. Si la previa calculara por su cuenta —o peor, en
 * el navegador—, el número que alguien aprueba y el que se guarda podrían
 * diferir, y es dinero.
 */
async function prepararMovimiento(db: PrismaClient, id: string, priceListId: string, actor: Actor) {
  if (actor.role !== 'admin') {
    throw new QuoteError(403, 'Solo un admin puede mover una cotización de catálogo.');
  }
  const existing = await db.quote.findFirst({
    where: { id, ...ownershipWhere(actor) },
    // Los extras y el descuento de cortesía NO viven en el catálogo, así que
    // mover de catálogo no debe tocarlos. Sin leerlos aquí, el recálculo los
    // dejaría fuera y el movimiento le borraría dinero a la cotización.
    include: SELECCION_INCLUDE,
  });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(existing);

  const destino = await db.priceList.findUnique({ where: { id: priceListId } });
  if (!destino) throw new QuoteError(404, `El catálogo ${priceListId} no existe`);
  const origen = await db.priceList.findUnique({
    where: { id: existing.priceListId },
    select: { nombre: true },
  });

  const seleccion = await traducirSeleccion(db, existing, destino.id);
  const { breakdown, enriched } = await computeAndEnrich(
    db,
    toSelection({
      ...seleccionGuardada(existing),
      // Lo único que cambia son el paquete y los servicios, RETRADUCIDOS a los
      // registros equivalentes del catálogo destino.
      foodPackageId: seleccion.foodPackageId ?? undefined,
      addOns: seleccion.addOns,
    }),
    destino.id,
  );

  return {
    existing,
    destino,
    origen,
    seleccion,
    breakdown,
    enriched,
    antes: existing.total,
    despues: Math.round(breakdown.total),
  };
}

/**
 * Vista previa del movimiento: el mismo cálculo que `moverCatalogo`, sin tocar
 * la cotización ni la bitácora.
 *
 * La interfaz la usa para enseñar el antes y el después ANTES de confirmar.
 * Falla igual que el movimiento real (403, 404, 409 si el catálogo destino no
 * trae un paquete o servicio equivalente), y ese es el punto: quien va a mover
 * se entera del problema mientras todavía puede cancelar.
 */
export async function simularCatalogo(db: PrismaClient, id: string, priceListId: string, actor: Actor) {
  const { antes, despues } = await prepararMovimiento(db, id, priceListId, actor);
  return { antes, despues };
}

/**
 * Mueve una cotización a otro catálogo y la represia A PROPÓSITO.
 *
 * Es la única puerta que rompe el casamiento hecho al crear, y por eso es de
 * admin y deja rastro: el caso real es el cliente que apartó para 2027 y corre su
 * evento a 2029, donde los precios ya son otros. Devuelve el antes y el después
 * para que quien confirme vea con cuánto se va a quedar el cliente.
 */
export async function moverCatalogo(db: PrismaClient, id: string, priceListId: string, actor: Actor) {
  const { existing, destino, origen, seleccion, breakdown, enriched, antes, despues } =
    await prepararMovimiento(db, id, priceListId, actor);

  const quote = await db.quote.update({
    where: { id },
    data: {
      priceListId: destino.id,
      // El paquete y los servicios se guardan RETRADUCIDOS: si se dejaran los
      // ids viejos, el siguiente guardado del formulario reventaría.
      foodPackageId: seleccion.foodPackageId,
      addOns: seleccion.addOns as unknown as Prisma.InputJsonValue,
      breakdown: enriched as unknown as Prisma.InputJsonValue,
      total: despues,
      rentaTotal: Math.round(breakdown.rentaTotal),
    },
    include: includeRels,
  });

  await logActivity(db, {
    quoteId: id,
    tipo: 'catalogo',
    descripcion: `Catálogo: ${origen?.nombre ?? existing.priceListId} → ${destino.nombre} · total ${antes} → ${despues}`,
    meta: { de: existing.priceListId, a: destino.id, totalAntes: antes, totalDespues: despues },
    actorId: actor.id,
  });

  return { quote, antes, despues };
}

export async function updateStatus(
  db: PrismaClient,
  id: string,
  status: (typeof QUOTE_STATUSES)[number],
  actor: Actor,
) {
  const existing = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(existing);
  const updated = await db.quote.update({ where: { id }, data: { status }, include: includeRels });
  await logActivity(db, {
    quoteId: id,
    tipo: 'estatus',
    descripcion: `Estatus: ${existing.status} → ${status}`,
    meta: { de: existing.status, a: status },
    actorId: actor.id,
  });
  return updated;
}

// Datos operativos que se capturan al formalizar; alimentan el contrato, la
// hoja operativa por evento, el correo diario y el ERP futuro. No recalculan
// el desglose. Los horarios son columnas; la "hoja" rica va en Json.
export const hojaOperativaSchema = z.object({
  nombreFestejado: z.string().max(120).optional(),
  relacionCliente: z.string().max(60).optional(),
  horaMisa: z.string().max(20).optional(),
  capilla: z.boolean().optional(),
  fotografia: z.boolean().optional(),
  banquetero: z.string().max(120).optional(),
  banqueteroPaqHsa: z.boolean().optional(),
  estrado: z.string().max(60).optional(),
  pista: z.string().max(60).optional(),
  personalHsa: z.string().max(600).optional(), // derivado de personalHsaRows para impresión/ficha
  // Renglones estructurados del personal (elegidos de cuadrilla/empleados + horario).
  personalHsaRows: z
    .array(
      z.object({
        nombre: z.string().max(80),
        hora: z.string().max(20).optional(),
        rol: z.string().max(60).optional(),
      }),
    )
    .max(40)
    .optional(),
  personalSeguridadHora: z.string().max(20).optional(),
  personalSeguridadElementos: z.number().int().min(0).max(50).optional(),
  limpiezaNocturna: z.boolean().optional(),
  habitacion: z.string().max(20).optional(),
  seQuedaEquipo: z.string().max(200).optional(),
  maniobras: z.boolean().optional(), // sólo aparece en la hoja cuando está activo
  anotaciones: z.string().max(500).optional(), // notas libres (ej. "Colgante · Padre Carmelo · Fotos 18:00")
});

export const operativaSchema = z.object({
  horarioCivil: z.string().max(120).nullable().optional(),
  horaInicio: z.string().max(20).nullable().optional(),
  horaTermino: z.string().max(20).nullable().optional(),
  banqueteroId: z.string().nullable().optional(),
  hoja: hojaOperativaSchema.optional(),
});

export async function updateOperativa(db: PrismaClient, id: string, rawInput: unknown, actor: Actor) {
  const existing = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(existing);
  const input = operativaSchema.parse(rawInput);

  // El banquetero se elige del catálogo (para ventas por banquetero); guardamos
  // también su nombre en la hoja para que la impresión no dependa del join.
  let banquetero: { id: string; nombre: string } | null = null;
  if (input.banqueteroId) {
    banquetero = await db.banquetero.findUnique({ where: { id: input.banqueteroId }, select: { id: true, nombre: true } });
  }
  // Personal HSA: si llegan renglones estructurados, se deriva la cadena de texto
  // (una línea por persona) para que la ficha y la impresión no cambien.
  const rows = input.hoja?.personalHsaRows;
  const personalHsa = rows
    ? rows
        .map((r) => {
          const detalle = [r.nombre, r.rol].filter(Boolean).join(' · ');
          return r.hora ? `${r.hora} — ${detalle}` : detalle;
        })
        .join('\n')
    : input.hoja?.personalHsa;

  const hoja = {
    ...(input.hoja ?? {}),
    banquetero: banquetero?.nombre ?? input.hoja?.banquetero ?? null,
    personalHsa: personalHsa ?? null,
  };

  return db.quote.update({
    where: { id },
    data: {
      horarioCivil: input.horarioCivil ?? null,
      horaInicio: input.horaInicio ?? null,
      horaTermino: input.horaTermino ?? null,
      banqueteroId: input.banqueteroId ?? null,
      operativa: hoja as Prisma.InputJsonValue,
    },
    include: includeRels,
  });
}

/**
 * Eventos operativos de un día (hoja operativa completa por evento). Fuente
 * única para: el documento imprimible, el correo diario al admin y el ERP futuro.
 * Incluye apartados/formalizados/liquidados (los que ya son evento real).
 */
export async function getOperativaDelDia(db: PrismaClient, fechaISO: string) {
  const gte = new Date(`${fechaISO}T00:00:00.000Z`);
  const lt = new Date(gte);
  lt.setUTCDate(lt.getUTCDate() + 1);
  const quotes = await db.quote.findMany({
    where: {
      fechaEvento: { gte, lt },
      deletedAt: null,
      status: { in: ['formalizada', 'complementada', 'liquidada'] },
    },
    include: {
      client: true,
      eventType: true,
      createdBy: { select: { nombre: true } },
      banquetero: { select: { nombre: true } },
    },
    orderBy: { horaInicio: 'asc' },
  });

  const spaceIds = [...new Set(quotes.flatMap((q) => q.spaceIds))];
  const spaces = await db.space.findMany({ where: { id: { in: spaceIds } } });
  const spaceName = new Map(spaces.map((s) => [s.id, s.nombre]));

  return {
    fecha: fechaISO,
    eventos: quotes.map((q) => ({
      quoteId: q.id,
      fechaEvento: q.fechaEvento.toISOString(),
      invitados: q.invitados,
      tipoEvento: q.eventType?.nombre ?? 'Evento',
      lugar: q.spaceIds.map((id) => spaceName.get(id) ?? id).join(', '),
      cliente: q.client?.nombre ?? 'Cliente',
      // El festejado es dato OPERATIVO: sale aquí (hoja operativa, correo diario,
      // ERP) y nunca en el contrato, que lee al cliente porque es quien firma.
      // La columna manda sobre `hoja.nombreFestejado`, que es donde se capturaba
      // antes y queda como respaldo de los eventos anteriores.
      festejado: q.festejado ?? ((q.operativa as { nombreFestejado?: string } | null)?.nombreFestejado ?? null),
      festejadoTelefono: q.festejadoTelefono,
      banquetero: q.banquetero?.nombre ?? null,
      status: q.status,
      total: q.total,
      rentaTotal: q.rentaTotal,
      costoHoraExtra: Math.round(q.rentaTotal * 0.05),
      horaInicio: q.horaInicio,
      horaTermino: q.horaTermino,
      horarioCivil: q.horarioCivil,
      vendedor: q.createdBy?.nombre ?? null,
      hoja: (q.operativa ?? {}) as Record<string, unknown>,
    })),
  };
}

// --- Vigencia -----------------------------------------------------------------

// Los precios de una cotización valen 30 días (política del negocio, impresa en
// la página pública). `vigenciaHasta` se guarda y se muestra, pero NO degrada
// nada: el vencimiento automático se eliminó junto con el estatus `vencida`
// (punto 8, decisión del dueño). La consecuencia la aceptó explícitamente —
// nada limpia la agenda sola, y un borrador viejo sigue pintando su fecha hasta
// que alguien lo mande a la papelera.
export const VIGENCIA_DIAS = 30;

export function vigenciaDesde(creacion: Date): Date {
  const d = new Date(creacion);
  d.setUTCDate(d.getUTCDate() + VIGENCIA_DIAS);
  return d;
}

// --- Papelera (soft-delete) ---------------------------------------------------

const TRASH_RETENTION_DAYS = 30;

function trashCutoff(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - TRASH_RETENTION_DAYS);
  return d;
}

/** Borra definitivamente las cotizaciones en papelera con más de 30 días. Best-effort. */
export async function purgeExpiredTrash(db: PrismaClient): Promise<void> {
  try {
    const expired = await db.quote.findMany({
      where: { deletedAt: { lt: trashCutoff() } },
      select: { id: true },
    });
    if (expired.length === 0) return;
    const ids = expired.map((q) => q.id);
    await db.payment.deleteMany({ where: { quoteId: { in: ids } } });
    await db.activityLog.deleteMany({ where: { quoteId: { in: ids } } });
    await db.quote.deleteMany({ where: { id: { in: ids } } });
  } catch {
    // no bloquea la operación principal
  }
}

/** Envía una cotización a la papelera. Solo borradores y NUNCA con pagos
 *  registrados (candado anti-irregularidades: un cliente que pagó no puede
 *  terminar en la papelera). Queda registrado quién la eliminó. */
export async function softDeleteQuote(db: PrismaClient, id: string, actor: Actor) {
  const existing = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor), deletedAt: null } });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada');
  if (existing.status !== 'borrador') {
    throw new QuoteError(409, 'Solo se pueden eliminar cotizaciones en borrador');
  }
  const pagosVigentes = await db.payment.count({ where: { quoteId: id, anuladoAt: null } });
  if (pagosVigentes > 0) {
    throw new QuoteError(409, 'No se puede eliminar: la cotización tiene pagos registrados');
  }
  await db.quote.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity(db, {
    quoteId: id,
    tipo: 'eliminada',
    descripcion: 'Enviada a la papelera',
    actorId: actor.id,
  });
}

/** Restaura una cotización desde la papelera (queda registrado quién). */
export async function restoreQuote(db: PrismaClient, id: string, actor: Actor) {
  const existing = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor), deletedAt: { not: null } } });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada en la papelera');
  const restored = await db.quote.update({ where: { id }, data: { deletedAt: null }, include: includeRels });
  await logActivity(db, {
    quoteId: id,
    tipo: 'restaurada',
    descripcion: 'Restaurada de la papelera',
    actorId: actor.id,
  });
  return restored;
}

/** Cotizaciones en papelera (no purgadas). Purga las que ya pasaron los 30 días. */
export async function listTrash(db: PrismaClient, actor: Actor) {
  await purgeExpiredTrash(db);
  return db.quote.findMany({
    where: { ...ownershipWhere(actor), deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    include: includeRels,
  });
}

/**
 * Cuántas cotizaciones en papelera no ha visto ESTE usuario.
 *
 * El sello (`User.papeleraVistaAt`) es por usuario y el conteo respeta
 * `ownershipWhere`: una vendedora nunca cuenta lo que otra eliminó, y el admin
 * cuenta todo. Sin sello (nunca abrió la papelera) cuenta su papelera completa.
 *
 * No purga: es un contador que la interfaz pide seguido, y la purga de los 30
 * días ya corre en `listQuotes` y `listTrash`.
 */
export async function contarPapeleraSinVer(db: PrismaClient, actor: Actor): Promise<number> {
  const user = await db.user.findUnique({
    where: { id: actor.id },
    select: { papeleraVistaAt: true },
  });
  const sello = user?.papeleraVistaAt ?? null;
  return db.quote.count({
    where: {
      ...ownershipWhere(actor),
      // `gt` sobre el sello, no `not: null` a secas: lo ya visto no vuelve a
      // contar. Restaurar una cotización la saca del conteo por sí solo, porque
      // le pone `deletedAt` en null.
      deletedAt: sello ? { gt: sello } : { not: null },
    },
  });
}

/** Marca la papelera como vista AHORA para este usuario (pone el contador en cero). */
export async function marcarPapeleraVista(db: PrismaClient, actor: Actor): Promise<Date> {
  const vistoAt = new Date();
  await db.user.update({ where: { id: actor.id }, data: { papeleraVistaAt: vistoAt } });
  return vistoAt;
}

export async function listQuotes(db: PrismaClient, actor: Actor) {
  void purgeExpiredTrash(db);
  const quotes = await db.quote.findMany({
    where: { ...ownershipWhere(actor), deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: includeRels,
  });
  const estados = await loadEstadoCuentaBulk(db, quotes);
  // `desfase`: el estatus exige un pago que aún no está cubierto (bandera de auditoría).
  return quotes.map((q) => ({ ...q, desfase: estados.get(q.id)?.desfase ?? false }));
}

export async function getQuote(db: PrismaClient, id: string, actor: Actor) {
  const quote = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) }, include: includeRels });
  if (!quote) return null;
  const { estadoCuenta, payments } = await loadEstadoCuenta(db, quote);
  const activityLog = await db.activityLog.findMany({ where: { quoteId: id }, orderBy: { createdAt: 'desc' }, include: { actor: { select: { nombre: true } } } });

  // El candado de facturación se calcula al vuelo: depende del calendario, no de
  // un campo guardado, así que un pago "caduca" solo al cerrar su mes.
  const hoy = hoyCivilMexico();
  const paymentsConCandado = payments.map((p) => {
    const est = estadoFacturaPago(p, hoy);
    return { ...p, facturable: est.facturable, motivoFactura: est.motivo };
  });

  return {
    quote,
    estadoCuenta,
    payments: paymentsConCandado,
    fiscalEditable: datosFiscalesEditables(payments),
    activityLog,
  };
}

/** Vista pública por token: cotización + estado de cuenta con pagos. */
export async function getByToken(db: PrismaClient, token: string) {
  const quote = await db.quote.findUnique({ where: { publicToken: token }, include: includeRels });
  if (!quote || quote.deletedAt) return null; // en papelera: invisible para el cliente
  const { estadoCuenta, payments } = await loadEstadoCuenta(db, quote);
  const pagosPublicos = payments
    .filter((p) => p.anuladoAt == null)
    .map((p) => ({
      id: p.id,
      folio: p.folio,
      monto: p.monto,
      concepto: p.concepto,
      metodo: p.metodo,
      fecha: p.fecha.toISOString(),
      tieneComprobante: Boolean(p.comprobanteKey),
    }));
  return { quote, estadoCuenta: { ...estadoCuenta, pagos: pagosPublicos } };
}
