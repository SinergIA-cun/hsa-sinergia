import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import { computeQuote, quoteSelectionSchema, type QuoteSelection } from '@hsa/shared';
import { loadCatalog } from '../catalog/loader.js';
import { logActivity } from './activityLog.js';
import { computeEstadoCuenta, esUpgrade, type EstadoCuenta } from './estadoCuenta.js';

export interface Actor {
  id: string;
  role: 'ventas' | 'admin';
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

const clientSchema = z.object({
  nombre: z.string().min(1),
  telefono: z.string().optional(),
  correo: z.string().email().optional(),
  empresa: z.string().optional(),
});

export const createQuoteSchema = quoteSelectionSchema
  .extend({
    eventTypeId: z.string(),
    horasEvento: z.number().int().positive().optional(),
    esCortesia: z.boolean().default(false),
    capillaHorario: z.string().max(20).nullable().optional(),
    clientId: z.string().optional(),
    client: clientSchema.optional(),
  })
  .refine((d) => Boolean(d.clientId ?? d.client), {
    message: 'Se requiere clientId o datos de client',
  })
  .refine((d) => d.spaceIds.length === 1, { message: 'Solo se permite un espacio por evento' });

export const updateQuoteSchema = quoteSelectionSchema
  .extend({
    eventTypeId: z.string(),
    horasEvento: z.number().int().positive().nullable().optional(),
    esCortesia: z.boolean().default(false),
    capillaHorario: z.string().max(20).nullable().optional(),
    client: clientSchema.optional(),
  })
  .refine((d) => d.spaceIds.length === 1, { message: 'Solo se permite un espacio por evento' });

export const statusSchema = z.object({ status: z.enum(QUOTE_STATUSES) });

const includeRels = { client: true, eventType: true, createdBy: { select: { id: true, nombre: true } } };

// Se permite editar el desglose incluso con compromiso de pago (apartada/formalizada);
// las ediciones en esos estatus quedan registradas en la bitácora de actividad.
const EDITABLE_STATUSES = new Set(['borrador', 'enviada', 'aceptada', 'apartada', 'formalizada']);

/** Calcula el desglose y enriquece las líneas de renta con el nombre del espacio. */
async function computeAndEnrich(db: PrismaClient, selection: QuoteSelection) {
  const catalog = await loadCatalog(db);
  const breakdown = computeQuote(catalog, selection);
  const spaces = await db.space.findMany({ where: { id: { in: selection.spaceIds } } });
  const nameById = new Map(spaces.map((s) => [s.id, s.nombre]));
  const enriched = {
    ...breakdown,
    lines: breakdown.lines.map((l) => {
      const m = /^Renta (.+)$/.exec(l.concepto);
      const nombre = m ? nameById.get(m[1]!) : undefined;
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
  };
}

/** Ventas solo ve/edita lo suyo; admin todo. */
export function ownershipWhere(actor: Actor): Prisma.QuoteWhereInput {
  return actor.role === 'admin' ? {} : { createdById: actor.id };
}

// El plan de pagos, el saldo y el finiquito se miden SOLO sobre la renta (lo que
// cobra HSA). Los alimentos se pagan directo al banquetero y no se rastrean aquí.
/** Carga regla del espacio + pagos y arma el estado de cuenta (base: renta). */
export async function loadEstadoCuenta(db: PrismaClient, quote: {
  id: string; rentaTotal: number; fechaEvento: Date; status: string; spaceIds: string[];
}) {
  const spaceId = quote.spaceIds[0];
  const [rule, payments, firstApartado] = await Promise.all([
    spaceId ? db.spacePaymentRule.findUnique({ where: { spaceId } }) : Promise.resolve(null),
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
  const ec = computeEstadoCuenta({
    total: quote.rentaTotal,
    fechaEvento: quote.fechaEvento,
    status: quote.status,
    rule: rule ? { anticipo: rule.anticipo, complementoPct: rule.complementoPct, liquidarDiasAntes: rule.liquidarDiasAntes } : null,
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
  const spaceIds = [...new Set(quotes.map((q) => q.spaceIds[0]).filter(Boolean) as string[])];

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
    const rule = ruleBySpace.get(q.spaceIds[0] ?? '');
    out.set(
      q.id,
      computeEstadoCuenta({
        total: q.rentaTotal,
        fechaEvento: q.fechaEvento,
        status: q.status,
        rule: rule
          ? { anticipo: rule.anticipo, complementoPct: rule.complementoPct, liquidarDiasAntes: rule.liquidarDiasAntes }
          : null,
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
  const { breakdown, enriched } = await computeAndEnrich(db, toSelection(input));

  let clientId = input.clientId;
  if (!clientId && input.client) {
    const created = await db.client.create({ data: input.client });
    clientId = created.id;
  }

  const created = await db.quote.create({
    data: {
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
      usaDjHoraExtra: input.usaDjHoraExtra ?? false,
      foodPackageId: input.foodPackageId ?? null,
      addOns: input.addOns as unknown as Prisma.InputJsonValue,
      breakdown: enriched as unknown as Prisma.InputJsonValue,
      total: Math.round(breakdown.total),
      rentaTotal: Math.round(breakdown.rentaTotal),
      publicToken: randomUUID().replace(/-/g, ''),
      vigenciaHasta: vigenciaDesde(new Date()),
      createdById: actor.id,
    },
    include: includeRels,
  });
  await logActivity(db, { quoteId: created.id, tipo: 'creada', descripcion: 'Cotización creada', actorId: actor.id });
  return created;
}

/**
 * Clona una cotización como nueva (mismo cliente/evento/figuras), en borrador
 * y con token propio. Ahorra recapturar; el vendedor ajusta la fecha después.
 * Copia el desglose tal cual; al reeditar y guardar se recalcula con precios vigentes.
 */
export async function duplicateQuote(db: PrismaClient, id: string, actor: Actor) {
  const src = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!src) throw new QuoteError(404, 'Cotización no encontrada');

  const created = await db.quote.create({
    data: {
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
      breakdown: src.breakdown as unknown as Prisma.InputJsonValue,
      total: src.total,
      rentaTotal: src.rentaTotal,
      publicToken: randomUUID().replace(/-/g, ''),
      vigenciaHasta: vigenciaDesde(new Date()),
      createdById: actor.id,
    },
    include: includeRels,
  });
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
  const { breakdown, enriched } = await computeAndEnrich(db, toSelection(input));

  if (input.client) {
    await db.client.update({ where: { id: existing.clientId }, data: input.client });
  }

  const updated = await db.quote.update({
    where: { id },
    data: {
      eventTypeId: input.eventTypeId,
      fechaEvento: new Date(`${input.fecha}T00:00:00.000Z`),
      horasEvento: input.horasEvento ?? null,
      invitados: input.invitados,
      spaceIds: input.spaceIds,
      horasExtra: input.horasExtra,
      usaCapilla: input.usaCapilla ?? false,
      capillaHorario: input.capillaHorario ?? null,
      esCortesia: input.esCortesia ?? false,
      usaDjHoraExtra: input.usaDjHoraExtra ?? false,
      foodPackageId: input.foodPackageId ?? null,
      addOns: input.addOns as unknown as Prisma.InputJsonValue,
      breakdown: enriched as unknown as Prisma.InputJsonValue,
      total: Math.round(breakdown.total),
      rentaTotal: Math.round(breakdown.rentaTotal),
    },
    include: includeRels,
  });

  if (existing.status === 'apartada' || existing.status === 'formalizada') {
    await logActivity(db, {
      quoteId: id,
      tipo: 'edicion',
      descripcion: `Edición en ${existing.status}: total ${existing.total} → ${updated.total}`,
      meta: { totalAntes: existing.total, totalDespues: updated.total },
      actorId: actor.id,
    });
  }

  return updated;
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
      status: { in: ['apartada', 'formalizada', 'liquidada'] },
    },
    include: { client: true, eventType: true, createdBy: { select: { nombre: true } } },
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

// --- Vigencia / vencimiento automático ---------------------------------------

// Los precios de una cotización valen 30 días (política del negocio, ver página
// pública). Pasada la vigencia sin convertirse en reserva, la cotización vence.
export const VIGENCIA_DIAS = 30;
// Estatus "en pipeline": ofertas aún no reservadas. Solo estas vencen; un evento
// ya apartado/formalizado/liquidado nunca se degrada automáticamente.
const PIPELINE_STATUSES = ['borrador', 'enviada', 'aceptada'] as const;

export function vigenciaDesde(creacion: Date): Date {
  const d = new Date(creacion);
  d.setUTCDate(d.getUTCDate() + VIGENCIA_DIAS);
  return d;
}

/**
 * Marca como "vencida" toda cotización en pipeline cuya vigencia ya pasó
 * (por `vigenciaHasta`, o `createdAt + 30 días` para las previas al campo).
 * Un solo sentido: no revive sola — se revive duplicándola. Best-effort.
 * Devuelve cuántas venció (útil para pruebas).
 */
export async function expireStaleQuotes(db: PrismaClient, now: Date = new Date()): Promise<number> {
  try {
    const hace30 = new Date(now);
    hace30.setUTCDate(hace30.getUTCDate() - VIGENCIA_DIAS);
    const stale = await db.quote.findMany({
      where: {
        status: { in: [...PIPELINE_STATUSES] },
        deletedAt: null,
        OR: [
          { vigenciaHasta: { lt: now } },
          { vigenciaHasta: null, createdAt: { lt: hace30 } },
        ],
      },
      select: { id: true, status: true },
    });
    if (stale.length === 0) return 0;
    await db.quote.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { status: 'vencida' } });
    for (const s of stale) {
      await logActivity(db, {
        quoteId: s.id,
        tipo: 'estatus',
        descripcion: `Estatus: ${s.status} → vencida (vencimiento automático por vigencia)`,
        meta: { de: s.status, a: 'vencida', motivo: 'vigencia' },
        actorId: null,
      });
    }
    return stale.length;
  } catch {
    return 0; // no bloquea la operación principal
  }
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

/** Cotizaciones en papelera (no expiradas). Purga las vencidas de paso. */
export async function listTrash(db: PrismaClient, actor: Actor) {
  await purgeExpiredTrash(db);
  return db.quote.findMany({
    where: { ...ownershipWhere(actor), deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    include: includeRels,
  });
}

export async function listQuotes(db: PrismaClient, actor: Actor) {
  void purgeExpiredTrash(db);
  await expireStaleQuotes(db); // vencimiento automático por vigencia antes de listar
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
  return { quote, estadoCuenta, payments, activityLog };
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
