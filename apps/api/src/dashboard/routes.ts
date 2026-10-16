import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { getDashboard } from './service.js';
import { descuadres } from './descuadres.js';
import { QuoteError } from '../quotes/service.js';
import type { Actor } from '../quotes/service.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', { preHandler: requireAuth }, async (req) => {
    return getDashboard(app.prisma, req.user as Actor);
  });

  // Eventos donde lo cobrado no cuadra con lo contratado (solo admin).
  app.get('/dashboard/descuadres', { preHandler: requireAuth }, async (req, reply) => {
    try {
      return { descuadres: await descuadres(app.prisma, req.user as Actor) };
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });
}
