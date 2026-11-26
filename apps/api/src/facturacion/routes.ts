import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { QuoteError } from '../quotes/service.js';
import { facturarPago, mesActual, mesSchema } from './facturar.js';
import { panelFacturacion } from './panel.js';
import { sincronizarFacturas } from './sincronizar.js';

/**
 * El panel de Facturación (26-nov-2026). Solo entra quien tenga el permiso
 * `accesoFacturacion`, que prende un admin por persona: ser admin NO basta.
 *
 * Se revisa en la base en CADA petición (no en el token de la sesión): quitarle
 * el permiso a alguien tiene que surtir efecto en el momento, no cuando se le
 * venza la sesión.
 */
export async function requireFacturacion(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    await reply.code(401).send({ error: 'No autenticado' });
    return;
  }
  const u = await req.server.prisma.user.findUnique({ where: { id: req.user.id }, select: { activo: true, accesoFacturacion: true } });
  if (!u?.activo || !u.accesoFacturacion) {
    await reply.code(403).send({ error: 'No tienes acceso al panel de facturación.' });
  }
}

async function conErrores<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
    throw e;
  }
}

export async function facturacionRoutes(app: FastifyInstance): Promise<void> {
  const guardia = { preHandler: requireFacturacion };

  /** Lo facturado y lo pendiente de un mes (por omisión, el actual). */
  app.get('/facturacion/panel', guardia, async (req, reply) => {
    const q = z.object({ mes: mesSchema.optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'mes como AAAA-MM' });
    return {
      ...(await panelFacturacion(app.prisma, q.data.mes ?? mesActual())),
      pacConfigurado: app.facturacion != null,
    };
  });

  /**
   * Factura UN pago. "Facturar todo" en la pantalla llama a esta ruta pago por
   * pago: cada factura se hace por sí sola, nunca se agrupan.
   */
  app.post<{ Params: { id: string } }>('/facturacion/pagos/:id/facturar', guardia, async (req, reply) =>
    conErrores(reply, () =>
      facturarPago(app.prisma, req.params.id, {
        proveedor: app.facturacion,
        mailer: app.mailer,
        actorId: req.user!.id,
        origen: 'app',
      }),
    ),
  );

  /** El PDF de la factura de un pago, o de una factura del PAC por su UUID. */
  app.get<{ Params: { uuid: string } }>('/facturacion/facturas/:uuid/pdf', guardia, async (req, reply) =>
    conErrores(reply, async () => {
      if (!app.facturacion) return reply.code(503).send({ error: 'El PAC no está configurado.' });
      const uuid = req.params.uuid;
      if (!/^[0-9a-fA-F-]{20,40}$/.test(uuid)) return reply.code(400).send({ error: 'UUID inválido' });
      const pdf = await (await app.facturacion()).pac.pdf(uuid);
      return reply.type('application/pdf').header('Content-Disposition', `inline; filename="${uuid}.pdf"`).send(pdf);
    }),
  );

  /** Revisar el PAC ahora, sin esperar la siguiente vuelta programada. */
  app.post('/facturacion/revisar', guardia, async (_req, reply) => {
    if (!app.lectorPac) return reply.code(503).send({ error: 'El PAC no está configurado.' });
    return sincronizarFacturas(app.prisma, app.lectorPac, { motivo: 'manual' });
  });
}
