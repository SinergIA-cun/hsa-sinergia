import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../auth/plugin.js';
import { QuoteError, ownershipWhere, type Actor } from '../quotes/service.js';
import { reenviarCorreo } from './cola.js';

/** Los correos que se le mandaron (o se le van a mandar) al cliente de un evento. */
export async function correoRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/quotes/:id/correos', { preHandler: requireAuth }, async (req, reply) => {
    const q = await app.prisma.quote.findFirst({ where: { id: req.params.id, ...ownershipWhere(req.user as Actor) }, select: { id: true } });
    if (!q) return reply.code(404).send({ error: 'Cotización no encontrada' });
    const correos = await app.prisma.correoCliente.findMany({
      where: { quoteId: q.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, tipo: true, paymentId: true, para: true, estado: true, intentos: true, error: true, enviadoAt: true, createdAt: true },
    });
    return { correos, configurado: Boolean(app.config.SMTP_HOST && app.config.SMTP_USER && app.config.SMTP_PASS) };
  });

  app.post<{ Params: { id: string; correoId: string } }>(
    '/quotes/:id/correos/:correoId/reenviar',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        return { correo: await reenviarCorreo(app.prisma, req.params.id, req.params.correoId) };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );
}
