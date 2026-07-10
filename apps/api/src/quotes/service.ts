import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import { computeQuote, quoteSelectionSchema, type QuoteSelection } from '@hsa/shared';
import { loadCatalog } from '../catalog/loader.js';
import { logActivity } from './activityLog.js';
import { computeEstadoCuenta } from './estadoCuenta.js';

export interface Actor {
  id: string;
  role: 'vendedora' | 'admin';
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
  foodPackageId?: string;
  addOns: { addOnId: string; cantidad: number }[];
}): QuoteSelection {
  return {
    fecha: input.fecha,
    invitados: input.invitados,
    spaceIds: input.spaceIds,
    horasExtra: input.horasExtra,
    foodPackageId: input.foodPackageId,
    addOns: input.addOns,
  };
}

/** Vendedora solo ve/edita lo suyo; admin todo. */
export function ownershipWhere(actor: Actor): Prisma.QuoteWhereInput {
  return actor.role === 'admin' ? {} : { createdById: actor.id };
}

/** Carga regla del espacio + pagos y arma el estado de cuenta de una cotización. */
export async function loadEstadoCuenta(db: PrismaClient, quote: {
  id: string; total: number; fechaEvento: Date; status: string; spaceIds: string[];
}) {
  const spaceId = quote.spaceIds[0];
  const [rule, payments, firstApartado] = await Promise.all([
    spaceId ? db.spacePaymentRule.findUnique({ where: { spaceId } }) : Promise.resolve(null),
    db.payment.findMany({ where: { quoteId: quote.id }, orderBy: { fecha: 'asc' } }),
    db.activityLog.findFirst({
      where: { quoteId: quote.id, tipo: 'estatus', descripcion: { contains: 'apartada' } },
      orderBy: { createdAt: 'asc' }, select: { createdAt: true },
    }),
  ]);
  const ec = computeEstadoCuenta({
    total: quote.total,
    fechaEvento: quote.fechaEvento,
    status: quote.status,
    rule: rule ? { anticipo: rule.anticipo, complementoPct: rule.complementoPct, liquidarDiasAntes: rule.liquidarDiasAntes } : null,
    payments: payments.map((p) => ({ monto: p.monto, anuladoAt: p.anuladoAt })),
    fechaApartado: firstApartado?.createdAt ?? null,
  });
  return { estadoCuenta: ec, payments };
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
      foodPackageId: input.foodPackageId ?? null,
      addOns: input.addOns as unknown as Prisma.InputJsonValue,
      breakdown: enriched as unknown as Prisma.InputJsonValue,
      total: Math.round(breakdown.total),
      rentaTotal: Math.round(breakdown.rentaTotal),
      publicToken: randomUUID().replace(/-/g, ''),
      createdById: actor.id,
    },
    include: includeRels,
  });
  await logActivity(db, { quoteId: created.id, tipo: 'creada', descripcion: 'Cotización creada', actorId: actor.id });
  return created;
}

export class QuoteError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function updateQuote(db: PrismaClient, id: string, rawInput: unknown, actor: Actor) {
  const existing = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada');
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

export function listQuotes(db: PrismaClient, actor: Actor) {
  return db.quote.findMany({
    where: ownershipWhere(actor),
    orderBy: { createdAt: 'desc' },
    include: includeRels,
  });
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
  if (!quote) return null;
  const { estadoCuenta, payments } = await loadEstadoCuenta(db, quote);
  const pagosPublicos = payments
    .filter((p) => p.anuladoAt == null)
    .map((p) => ({ id: p.id, monto: p.monto, concepto: p.concepto, fecha: p.fecha.toISOString(), tieneComprobante: Boolean(p.comprobanteUrl) }));
  return { quote, estadoCuenta: { ...estadoCuenta, pagos: pagosPublicos } };
}
