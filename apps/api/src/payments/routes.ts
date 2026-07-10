import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { QuoteError, type Actor } from '../quotes/service.js';
import { registerPayment, anularPayment, anularSchema } from './service.js';

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/quotes/:id/payments', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const result = await registerPayment(app.prisma, req.params.id, req.body, req.user as Actor);
      return reply.code(201).send(result);
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.patch<{ Params: { id: string; paymentId: string } }>(
    '/quotes/:id/payments/:paymentId/anular',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = anularSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Motivo requerido' });
      try {
        const result = await anularPayment(app.prisma, req.params.id, req.params.paymentId, parsed.data.motivo, req.user as Actor);
        return result;
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );
}
