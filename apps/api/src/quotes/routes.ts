import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { createQuote, getQuote, listQuotes, getByToken } from './service.js';

export async function quoteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/quotes', { preHandler: requireAuth }, async (req, reply) => {
    const quote = await createQuote(app.prisma, req.body, req.user!.id);
    return reply.code(201).send({ quote });
  });

  app.get('/quotes', { preHandler: requireAuth }, async () => {
    return { quotes: await listQuotes(app.prisma) };
  });

  app.get<{ Params: { id: string } }>(
    '/quotes/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const quote = await getQuote(app.prisma, req.params.id);
      if (!quote) return reply.code(404).send({ error: 'Cotización no encontrada' });
      return { quote };
    },
  );

  // PÚBLICA: sin auth. La usa el link/QR del cliente.
  app.get<{ Params: { token: string } }>('/c/:token', async (req, reply) => {
    const result = await getByToken(app.prisma, req.params.token);
    if (!result) return reply.code(404).send({ error: 'No encontrado' });
    return result;
  });
}
