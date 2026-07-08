import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import { computeQuote, quoteSelectionSchema, type QuoteSelection } from '@hsa/shared';
import { loadCatalog } from '../catalog/loader.js';

export const createQuoteSchema = quoteSelectionSchema
  .extend({
    eventTypeId: z.string(),
    horasEvento: z.number().int().positive().optional(),
    clientId: z.string().optional(),
    client: z
      .object({
        nombre: z.string().min(1),
        telefono: z.string().optional(),
        correo: z.string().email().optional(),
        empresa: z.string().optional(),
      })
      .optional(),
  })
  .refine((d) => Boolean(d.clientId ?? d.client), {
    message: 'Se requiere clientId o datos de client',
  });

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

export async function createQuote(
  db: PrismaClient,
  rawInput: unknown,
  createdById?: string,
) {
  const input = createQuoteSchema.parse(rawInput);
  const catalog = await loadCatalog(db);

  const selection: QuoteSelection = {
    fecha: input.fecha,
    invitados: input.invitados,
    spaceIds: input.spaceIds,
    horasExtra: input.horasExtra,
    foodPackageId: input.foodPackageId,
    addOns: input.addOns,
  };
  const breakdown = computeQuote(catalog, selection);

  // Enriquecer las líneas de renta con el nombre del espacio (el motor solo
  // conoce el id) para que el desglose persistido sea legible.
  const spaces = await db.space.findMany({ where: { id: { in: input.spaceIds } } });
  const nameById = new Map(spaces.map((s) => [s.id, s.nombre]));
  const enrichedBreakdown = {
    ...breakdown,
    lines: breakdown.lines.map((l) => {
      const m = /^Renta (.+)$/.exec(l.concepto);
      const nombre = m ? nameById.get(m[1]!) : undefined;
      return nombre ? { ...l, concepto: `Renta ${nombre}` } : l;
    }),
  };

  let clientId = input.clientId;
  if (!clientId && input.client) {
    const created = await db.client.create({ data: input.client });
    clientId = created.id;
  }

  const publicToken = randomUUID().replace(/-/g, '');
  return db.quote.create({
    data: {
      clientId: clientId!,
      eventTypeId: input.eventTypeId,
      fechaEvento: new Date(`${input.fecha}T00:00:00`),
      horasEvento: input.horasEvento ?? null,
      invitados: input.invitados,
      spaceIds: input.spaceIds,
      horasExtra: input.horasExtra,
      foodPackageId: input.foodPackageId ?? null,
      addOns: input.addOns as unknown as Prisma.InputJsonValue,
      breakdown: enrichedBreakdown as unknown as Prisma.InputJsonValue,
      total: Math.round(breakdown.total),
      rentaTotal: Math.round(breakdown.rentaTotal),
      publicToken,
      createdById: createdById ?? null,
    },
    include: { client: true, eventType: true },
  });
}

export function getQuote(db: PrismaClient, id: string) {
  return db.quote.findUnique({ where: { id }, include: { client: true, eventType: true } });
}

export function listQuotes(db: PrismaClient) {
  return db.quote.findMany({
    orderBy: { createdAt: 'desc' },
    include: { client: true, eventType: true },
  });
}

/** Vista pública por token: cotización + estado de cuenta (pagos llegan en Fase 5). */
export async function getByToken(db: PrismaClient, token: string) {
  const quote = await db.quote.findUnique({
    where: { publicToken: token },
    include: { client: true, eventType: true },
  });
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
