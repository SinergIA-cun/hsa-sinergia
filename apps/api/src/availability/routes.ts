import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { getAvailability, getAgenda } from './service.js';

const availQuery = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spaceIds: z.string().min(1), // csv
  excludeQuoteId: z.string().optional(),
});

const agendaQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function availabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/availability', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = availQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parámetros inválidos' });
    const { fecha, spaceIds, excludeQuoteId } = parsed.data;
    const ids = spaceIds.split(',').filter(Boolean);
    return getAvailability(app.prisma, fecha, ids, excludeQuoteId);
  });

  app.get('/agenda', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = agendaQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parámetros inválidos' });
    return getAgenda(app.prisma, parsed.data.from, parsed.data.to);
  });
}
