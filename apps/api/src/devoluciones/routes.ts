import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth/plugin.js';
import { QuoteError, type Actor } from '../quotes/service.js';
import { devolverACliente, devolverABanquetero, anularDevolucion, anotarNotaCredito } from './service.js';

/** Un QuoteError sale con su código; lo demás (ZodError → 400) va al handler global. */
async function responder(reply: FastifyReply, trabajo: Promise<unknown>, codigo = 200) {
  try {
    return reply.code(codigo).send(await trabajo);
  } catch (e) {
    if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
    throw e;
  }
}

/** Devoluciones: todas de admin (es dinero que sale de la hacienda). */
export async function devolucionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/quotes/:id/devoluciones', { preHandler: requireAdmin }, (req, reply) =>
    responder(reply, devolverACliente(app.prisma, req.params.id, req.body, req.user as Actor), 201),
  );
  app.post<{ Params: { id: string } }>('/banqueteros/:id/devoluciones', { preHandler: requireAdmin }, (req, reply) =>
    responder(reply, devolverABanquetero(app.prisma, req.params.id, req.body, req.user as Actor), 201),
  );
  app.patch<{ Params: { id: string } }>('/devoluciones/:id/anular', { preHandler: requireAdmin }, (req, reply) =>
    responder(reply, anularDevolucion(app.prisma, req.params.id, req.body, req.user as Actor)),
  );
  app.patch<{ Params: { id: string } }>('/devoluciones/:id/nota-credito', { preHandler: requireAdmin }, (req, reply) =>
    responder(reply, anotarNotaCredito(app.prisma, req.params.id, req.body, req.user as Actor)),
  );
}
