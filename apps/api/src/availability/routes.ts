import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { getAvailability, getAgenda, fechasLibres } from './service.js';

const availQuery = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spaceIds: z.string().min(1), // csv
  excludeQuoteId: z.string().optional(),
  /**
   * El apartado que se está convirtiendo. Sin esta salida, la pantalla de
   * conversión pintaría sus propios espacios como APARTADOS —lo están, por él
   * mismo— y parecería que la fecha no se puede usar.
   */
  excludeApartadoId: z.string().optional(),
});

const agendaQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function availabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/availability', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = availQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parámetros inválidos' });
    const { fecha, spaceIds, excludeQuoteId, excludeApartadoId } = parsed.data;
    const ids = spaceIds.split(',').filter(Boolean);
    return getAvailability(app.prisma, fecha, ids, excludeQuoteId, { excludeApartadoId, actor: req.user as { id: string; role: string } });
  });

  // Fechas libres cercanas para esos salones (mismo día de la semana).
  app.get('/availability/sugerencias', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = availQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parámetros inválidos' });
    const { fecha, spaceIds, excludeQuoteId } = parsed.data;
    return { fechas: await fechasLibres(app.prisma, fecha, spaceIds.split(',').filter(Boolean), { excludeQuoteId }) };
  });

  app.get('/agenda', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = agendaQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parámetros inválidos' });
    return getAgenda(app.prisma, parsed.data.from, parsed.data.to, { actor: req.user as { id: string; role: string } });
  });
}
