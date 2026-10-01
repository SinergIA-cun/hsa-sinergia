import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { QuoteError, simularFecha, type Actor } from './service.js';
import { cancelarEvento, eventosSinFecha, ponerEnStandby, reprogramarEvento } from './ciclo.js';

/** Cancelar, standby, reprogramar y la lista de eventos sin fecha. */
export async function cicloRoutes(app: FastifyInstance): Promise<void> {
  const conErrores = async <T>(reply: FastifyReply, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  };

  app.get('/quotes/sin-fecha', { preHandler: requireAuth }, async (req) => ({
    eventos: await eventosSinFecha(app.prisma, req.user as Actor),
  }));

  app.post<{ Params: { id: string } }>('/quotes/:id/cancelar', { preHandler: requireAuth }, (req, reply) =>
    conErrores(reply, () => cancelarEvento(app.prisma, req.params.id, req.body, req.user as Actor)),
  );

  app.post<{ Params: { id: string } }>('/quotes/:id/standby', { preHandler: requireAuth }, (req, reply) =>
    conErrores(reply, async () => ({
      quote: await ponerEnStandby(app.prisma, req.params.id, req.body, req.user as Actor),
    })),
  );

  app.post<{ Params: { id: string } }>('/quotes/:id/reprogramar', { preHandler: requireAuth }, (req, reply) =>
    conErrores(reply, async () => ({
      quote: await reprogramarEvento(app.prisma, req.params.id, req.body, req.user as Actor),
    })),
  );

  // Vista previa: POST porque lleva cuerpo, no porque escriba.
  app.post<{ Params: { id: string } }>('/quotes/:id/fecha/simular', { preHandler: requireAuth }, (req, reply) =>
    conErrores(reply, () => {
      const { fecha } = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
      return simularFecha(app.prisma, req.params.id, fecha, req.user as Actor);
    }),
  );
}
