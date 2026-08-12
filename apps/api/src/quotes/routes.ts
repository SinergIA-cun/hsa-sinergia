import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth/plugin.js';
import { cotizacionesDesplazadas } from './empalmes.js';
import {
  createQuote,
  duplicateQuote,
  getQuote,
  listQuotes,
  getByToken,
  moveQuoteDate,
  moverCatalogo,
  moverCatalogoSchema,
  simularCatalogo,
  updateQuote,
  updateStatus,
  updateOperativa,
  getOperativaDelDia,
  softDeleteQuote,
  restoreQuote,
  listTrash,
  statusSchema,
  QuoteError,
  type Actor,
} from './service.js';

export async function quoteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/quotes', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const quote = await createQuote(app.prisma, req.body, req.user as Actor);
      return reply.code(201).send({ quote });
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.get('/quotes', { preHandler: requireAuth }, async (req) => {
    return { quotes: await listQuotes(app.prisma, req.user as Actor) };
  });

  // Papelera: ruta estática ANTES de /quotes/:id (find-my-way prioriza estáticas de todos modos).
  app.get('/quotes/trash', { preHandler: requireAuth }, async (req) => {
    return { quotes: await listTrash(app.prisma, req.user as Actor) };
  });

  // Empalmes: cotizaciones vivas cuya fecha y espacio ya fueron apartados por otra.
  // También estática y también antes de /quotes/:id, por la misma razón que la papelera.
  app.get('/quotes/desplazadas', { preHandler: requireAuth }, async (req) => {
    return { items: await cotizacionesDesplazadas(app.prisma, req.user as Actor) };
  });

  app.delete<{ Params: { id: string } }>(
    '/quotes/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        await softDeleteQuote(app.prisma, req.params.id, req.user as Actor);
        return { ok: true };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/quotes/:id/restore',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const quote = await restoreQuote(app.prisma, req.params.id, req.user as Actor);
        return { quote };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/quotes/:id/duplicate',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const quote = await duplicateQuote(app.prisma, req.params.id, req.user as Actor);
        return reply.code(201).send({ quote });
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/quotes/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const result = await getQuote(app.prisma, req.params.id, req.user as Actor);
      if (!result) return reply.code(404).send({ error: 'Cotización no encontrada' });
      return result;
    },
  );

  app.put<{ Params: { id: string } }>(
    '/quotes/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const quote = await updateQuote(app.prisma, req.params.id, req.body, req.user as Actor);
        return { quote };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/quotes/:id/status',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Estatus inválido' });
      try {
        const quote = await updateStatus(
          app.prisma,
          req.params.id,
          parsed.data.status,
          req.user as Actor,
        );
        return { quote };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.patch<{ Params: { id: string } }>('/quotes/:id/fecha', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Fecha inválida' });
    try {
      const quote = await moveQuoteDate(app.prisma, req.params.id, parsed.data.fecha, req.user as Actor);
      return { quote };
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  // Vista previa del movimiento: el mismo cálculo, sin escribir nada. Es lo que
  // deja que el modal enseñe el antes y el después ANTES de confirmar, con el
  // número exacto que se va a guardar. POST porque lleva cuerpo, no porque mute.
  app.post<{ Params: { id: string } }>(
    '/quotes/:id/catalogo/simular',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = moverCatalogoSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Catálogo inválido' });
      try {
        return await simularCatalogo(app.prisma, req.params.id, parsed.data.priceListId, req.user as Actor);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // Mover de catálogo represia la cotización a propósito: es de admin y queda en
  // bitácora. Ver `moverCatalogo`.
  app.post<{ Params: { id: string } }>('/quotes/:id/catalogo', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = moverCatalogoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Catálogo inválido' });
    try {
      return await moverCatalogo(app.prisma, req.params.id, parsed.data.priceListId, req.user as Actor);
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/quotes/:id/operativa',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const quote = await updateOperativa(app.prisma, req.params.id, req.body, req.user as Actor);
        return { quote };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // Hoja operativa del día: eventos con toda la info operativa. Fuente del
  // documento imprimible, el correo diario y el ERP futuro. ?fecha=YYYY-MM-DD (default hoy).
  app.get<{ Querystring: { fecha?: string } }>(
    '/operativa',
    { preHandler: requireAuth },
    async (req, reply) => {
      const fecha = req.query.fecha ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return reply.code(400).send({ error: 'Fecha inválida (YYYY-MM-DD)' });
      }
      return getOperativaDelDia(app.prisma, fecha);
    },
  );

  // PÚBLICA: sin auth. La usa el link/QR del cliente.
  app.get<{ Params: { token: string } }>('/c/:token', async (req, reply) => {
    const result = await getByToken(app.prisma, req.params.token);
    if (!result) return reply.code(404).send({ error: 'No encontrado' });
    return result;
  });
}
