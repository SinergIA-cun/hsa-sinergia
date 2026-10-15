import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { QuoteError, type Actor } from '../quotes/service.js';
import {
  apartadosPorVencer,
  confirmarApartado,
  convertirApartado,
  crearApartado,
  fijarTope,
  liberarApartado,
  listarApartados,
  topePorDia,
} from './service.js';

const rango = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function conErrores<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
    throw e;
  }
}

/** Apartados rápidos con fila de espera. Ver `service.ts`. */
export async function apartadoRapidoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/apartados-rapidos', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = rango.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parámetros inválidos' });
    return listarApartados(app.prisma, parsed.data.from, parsed.data.to, req.user as Actor);
  });
  app.get('/apartados-rapidos/por-vencer', { preHandler: requireAuth }, async (req) => apartadosPorVencer(app.prisma, req.user as Actor));
  app.get('/apartados-rapidos/tope', { preHandler: requireAuth }, async () => ({ tope: await topePorDia(app.prisma) }));
  app.put('/apartados-rapidos/tope', { preHandler: requireAuth }, async (req, reply) =>
    conErrores(reply, () => fijarTope(app.prisma, req.body, req.user as Actor)),
  );
  app.post('/apartados-rapidos', { preHandler: requireAuth }, async (req, reply) =>
    conErrores(reply, async () => reply.code(201).send(await crearApartado(app.prisma, req.body, req.user as Actor))),
  );
  app.post<{ Params: { id: string } }>('/apartados-rapidos/:id/confirmar', { preHandler: requireAuth }, async (req, reply) =>
    conErrores(reply, () => confirmarApartado(app.prisma, req.params.id, req.user as Actor)),
  );
  app.post<{ Params: { id: string } }>('/apartados-rapidos/:id/liberar', { preHandler: requireAuth }, async (req, reply) =>
    conErrores(reply, () => liberarApartado(app.prisma, req.params.id, req.body, req.user as Actor)),
  );
  app.post<{ Params: { id: string } }>('/apartados-rapidos/:id/convertir', { preHandler: requireAuth }, async (req, reply) =>
    conErrores(reply, () => convertirApartado(app.prisma, req.params.id, req.body, req.user as Actor)),
  );
}
