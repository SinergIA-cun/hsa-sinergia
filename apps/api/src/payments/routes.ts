import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../auth/plugin.js';
import { QuoteError, type Actor } from '../quotes/service.js';
import {
  registerPayment,
  anularPayment,
  anularSchema,
  editarConcepto,
  desbloquearFactura,
  marcarFacturado,
  marcarFacturadoSchema,
  loadComprobanteInterno,
  loadComprobantePublico,
} from './service.js';
import { ServerStorage } from './storage.js';

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const storage = new ServerStorage(app.config.COMPROBANTES_DIR);

  // Registrar pago. Acepta multipart (con foto de comprobante, ideal para
  // cámara de tablet) o JSON (sin archivo).
  app.post<{ Params: { id: string } }>('/quotes/:id/payments', { preHandler: requireAuth }, async (req, reply) => {
    let rawInput: Record<string, unknown>;
    let file: { data: Buffer; mime: string } | undefined;

    if (req.isMultipart()) {
      const fields: Record<string, string> = {};
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          if (part.fieldname === 'comprobante' && buf.length > 0) {
            file = { data: buf, mime: part.mimetype };
          }
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
      rawInput = {
        monto: fields.monto != null ? Number(fields.monto) : undefined,
        metodo: fields.metodo,
        concepto: fields.concepto,
        fecha: fields.fecha,
        referencia: fields.referencia || undefined,
      };
    } else {
      rawInput = (req.body ?? {}) as Record<string, unknown>;
    }

    try {
      const result = await registerPayment(app.prisma, storage, req.params.id, rawInput, req.user as Actor, file);
      return reply.code(201).send(result);
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e; // ZodError → 400 vía el handler global
    }
  });

  app.patch<{ Params: { id: string; paymentId: string } }>(
    '/quotes/:id/payments/:paymentId/anular',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = anularSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Motivo requerido' });
      try {
        const result = await anularPayment(app.prisma, req.params.id, req.params.paymentId, parsed.data.motivo, req.user as Actor);
        return result;
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // Corregir a mano el concepto de un pago. Lo puede hacer VENTAS sobre lo suyo:
  // es un error de captura, no un movimiento de dinero. La regla del finiquito se
  // reaplica después de la corrección, así que la respuesta trae el concepto con
  // el que el pago quedó — que puede no ser el que se pidió.
  app.patch<{ Params: { id: string; paymentId: string } }>(
    '/quotes/:id/payments/:paymentId/concepto',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        return await editarConcepto(app.prisma, req.params.id, req.params.paymentId, req.body, req.user as Actor);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e; // ZodError → 400 vía el handler global
      }
    },
  );

  // Reabrir la facturación de un pago cuyo mes ya cerró (solo admin; queda en bitácora).
  app.patch<{ Params: { id: string; paymentId: string } }>(
    '/quotes/:id/payments/:paymentId/desbloquear-factura',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        return await desbloquearFactura(app.prisma, req.params.id, req.params.paymentId, req.user as Actor);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // Sellar un pago como facturado (solo admin). Sin PAC conectado, esta es la
  // única forma de que exista un `facturadoAt` y de que el candado fiscal cierre.
  app.post<{ Params: { id: string; paymentId: string } }>(
    '/quotes/:id/payments/:paymentId/facturado',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = marcarFacturadoSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
      try {
        return await marcarFacturado(app.prisma, req.params.id, req.params.paymentId, parsed.data, req.user as Actor);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // Proxy interno de la imagen del comprobante (vendedora/admin, con ownership).
  app.get<{ Params: { id: string; paymentId: string } }>(
    '/quotes/:id/comprobante/:paymentId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const c = await loadComprobanteInterno(app.prisma, storage, req.params.id, req.params.paymentId, req.user as Actor);
      if (!c) return reply.code(404).send({ error: 'Comprobante no encontrado' });
      return reply.type(c.mime).send(c.data);
    },
  );

  // Proxy público de la imagen del comprobante para el recibo del cliente (por token).
  app.get<{ Params: { token: string; paymentId: string } }>(
    '/c/:token/recibo/:paymentId/imagen',
    async (req, reply) => {
      const c = await loadComprobantePublico(app.prisma, storage, req.params.token, req.params.paymentId);
      if (!c) return reply.code(404).send({ error: 'No encontrado' });
      return reply.type(c.mime).send(c.data);
    },
  );
}
