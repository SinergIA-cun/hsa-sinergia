import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth, requireAdmin } from '../auth/plugin.js';
import { QuoteError, ownershipWhere, type Actor } from '../quotes/service.js';
import { descartarCorreo, enviarCorreoManual, reenviarCorreo, vistaCorreo } from './cola.js';
import { marcaDe } from './marca.js';

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
    return { correos, configurado: app.mailer != null };
  });

  // Correos manuales (21-oct-2026): ver cómo va a salir, mandarlo (con lo que se
  // haya editado) o descartarlo. Quien vende puede hacerlo en sus eventos.
  const suyo = async (quoteId: string, actor: Actor) =>
    Boolean(await app.prisma.quote.findFirst({ where: { id: quoteId, ...ownershipWhere(actor) }, select: { id: true } }));
  const conErrores = async (reply: FastifyReply, fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  };

  app.get<{ Params: { id: string; correoId: string } }>(
    '/quotes/:id/correos/:correoId/vista',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await suyo(req.params.id, req.user as Actor))) return reply.code(404).send({ error: 'Cotización no encontrada' });
      return conErrores(reply, async () => ({
        vista: await vistaCorreo(app.prisma, marcaDe(app.config), req.params.id, req.params.correoId),
      }));
    },
  );

  app.post<{ Params: { id: string; correoId: string } }>(
    '/quotes/:id/correos/:correoId/enviar',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await suyo(req.params.id, req.user as Actor))) return reply.code(404).send({ error: 'Cotización no encontrada' });
      return conErrores(reply, async () => ({
        correo: await enviarCorreoManual(app.prisma, app.mailer, marcaDe(app.config), req.params.id, req.params.correoId, req.body),
      }));
    },
  );

  app.post<{ Params: { id: string; correoId: string } }>(
    '/quotes/:id/correos/:correoId/descartar',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await suyo(req.params.id, req.user as Actor))) return reply.code(404).send({ error: 'Cotización no encontrada' });
      return conErrores(reply, async () => ({ correo: await descartarCorreo(app.prisma, req.params.id, req.params.correoId) }));
    },
  );

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
