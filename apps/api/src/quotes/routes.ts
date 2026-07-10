import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import {
  createQuote,
  getQuote,
  listQuotes,
  getByToken,
  updateQuote,
  updateStatus,
  statusSchema,
  QuoteError,
  type Actor,
} from './service.js';

export async function quoteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/quotes', { preHandler: requireAuth }, async (req, reply) => {
    const quote = await createQuote(app.prisma, req.body, req.user as Actor);
    return reply.code(201).send({ quote });
  });

  app.get('/quotes', { preHandler: requireAuth }, async (req) => {
    return { quotes: await listQuotes(app.prisma, req.user as Actor) };
  });

  app.get<{ Params: { id: string } }>(
    '/quotes/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const result = await getQuote(app.prisma, req.params.id, req.user as Actor);
      if (!result) return reply.code(404).send({ error: 'Cotización no encontrada' });
      return result;
    },
  );

  app.put<{ Params: { id: string } }>(
    '/quotes/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const quote = await updateQuote(app.prisma, req.params.id, req.body, req.user as Actor);
        return { quote };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/quotes/:id/status',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Estatus inválido' });
      try {
        const quote = await updateStatus(
          app.prisma,
          req.params.id,
          parsed.data.status,
          req.user as Actor,
        );
        return { quote };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // PÚBLICA: sin auth. La usa el link/QR del cliente.
  app.get<{ Params: { token: string } }>('/c/:token', async (req, reply) => {
    const result = await getByToken(app.prisma, req.params.token);
    if (!result) return reply.code(404).send({ error: 'No encontrado' });
    return result;
  });
}
