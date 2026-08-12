import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/plugin.js';
import { QuoteError } from '../quotes/service.js';
import { activarCatalogo, clonarCatalogo, listarCatalogos } from './service.js';

/**
 * Administración de catálogos. Todo bajo `requireAdmin`: quién fija los precios
 * del año que viene no es una decisión de ventas.
 */
export async function priceListRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/price-lists', { preHandler: requireAdmin }, async () => ({
    priceLists: await listarCatalogos(app.prisma),
  }));

  app.post('/admin/price-lists', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const priceList = await clonarCatalogo(app.prisma, req.body);
      return reply.code(201).send({ priceList });
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>(
    '/admin/price-lists/:id/activar',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const priceList = await activarCatalogo(app.prisma, req.params.id);
        return { priceList };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );
}
