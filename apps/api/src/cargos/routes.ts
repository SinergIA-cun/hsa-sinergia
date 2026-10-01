import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { QuoteError, ownershipWhere, type Actor } from '../quotes/service.js';
import { registrarCargo, anularCargo, cuentaDelEvento, productosDelEvento } from './service.js';

/** El punto de venta del evento: su cuenta de cargos posteriores a contratar. */
export async function cargoRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/quotes/:id/cuenta', { preHandler: requireAuth }, async (req, reply) => {
    const quote = await app.prisma.quote.findFirst({
      where: { id: req.params.id, ...ownershipWhere(req.user as Actor) },
      select: {
        id: true,
        priceListId: true,
        eventTypeId: true,
        breakdown: true,
        fechaEvento: true,
        invitados: true,
        spaceIds: true,
        foodPackageId: true,
      },
    });
    if (!quote) return reply.code(404).send({ error: 'Evento no encontrado' });
    const [cuenta, productos] = await Promise.all([
      cuentaDelEvento(app.prisma, quote.id),
      productosDelEvento(app.prisma, quote),
    ]);
    return { cuenta, productos };
  });

  // Ventas y admin cargan a la cuenta: es la venta de todos los días en el
  // mostrador. Anular es de admin, como anular un pago.
  app.post<{ Params: { id: string } }>('/quotes/:id/cargos', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const r = await registrarCargo(app.prisma, req.params.id, req.body, req.user as Actor);
      return reply.code(201).send(r);
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e; // ZodError → 400 vía el handler global
    }
  });

  app.patch<{ Params: { id: string; cargoId: string } }>(
    '/quotes/:id/cargos/:cargoId/anular',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        return await anularCargo(app.prisma, req.params.id, req.params.cargoId, req.body, req.user as Actor);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );
}
