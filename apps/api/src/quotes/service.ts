import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import { computeQuote, quoteSelectionSchema, type QuoteSelection } from '@hsa/shared';
import { loadCatalog } from '../catalog/loader.js';

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

// Solo se puede editar el desglose mientras la cotización no tenga compromiso de pago.
const EDITABLE_STATUSES = new Set(['borrador', 'enviada', 'aceptada']);

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
function ownershipWhere(actor: Actor): Prisma.QuoteWhereInput {
  return actor.role === 'admin' ? {} : { createdById: actor.id };
}

export async function createQuote(db: PrismaClient, rawInput: unknown, actor: Actor) {
  const input = createQuoteSchema.parse(rawInput);
  const { breakdown, enriched } = await computeAndEnrich(db, toSelection(input));

  let clientId = input.clientId;
  if (!clientId && input.client) {
    const created = await db.client.create({ data: input.client });
    clientId = created.id;
  }

  return db.quote.create({
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

  return db.quote.update({
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
}

export async function updateStatus(
  db: PrismaClient,
  id: string,
  status: (typeof QUOTE_STATUSES)[number],
  actor: Actor,
) {
  const existing = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada');
  return db.quote.update({ where: { id }, data: { status }, include: includeRels });
}

export function listQuotes(db: PrismaClient, actor: Actor) {
  return db.quote.findMany({
    where: ownershipWhere(actor),
    orderBy: { createdAt: 'desc' },
    include: includeRels,
  });
}

export async function getQuote(db: PrismaClient, id: string, actor: Actor) {
  return db.quote.findFirst({ where: { id, ...ownershipWhere(actor) }, include: includeRels });
}

/** Vista pública por token: cotización + estado de cuenta (pagos llegan en Fase 5). */
export async function getByToken(db: PrismaClient, token: string) {
  const quote = await db.quote.findUnique({ where: { publicToken: token }, include: includeRels });
  if (!quote) return null;
  const pagado = 0;
  return {
    quote,
    estadoCuenta: {
      total: quote.total,
      pagado,
      saldo: quote.total - pagado,
      pagos: [] as unknown[],
      plan: [] as unknown[],
    },
  };
}
