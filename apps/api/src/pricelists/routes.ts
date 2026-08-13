import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth/plugin.js';
import { QuoteError } from '../quotes/service.js';
import type { Actor } from '../quotes/service.js';
import { activarCatalogo, clonarCatalogo, listarCatalogos } from './service.js';
import {
  borrarPaquete,
  borrarServicio,
  crearPaquete,
  crearServicio,
  editarPaquete,
  editarRentas,
  editarServicio,
} from './editar.js';
import { impactoDeCatalogo } from './impacto.js';
import { listarBitacoraCatalogo } from './audit.js';

/**
 * Traduce `QuoteError` al código HTTP que trae. Lo demás sube al manejador global
 * (que ya convierte `ZodError` en 400).
 */
async function conErrores<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
    throw e;
  }
}

/**
 * Administración de catálogos. Todo bajo `requireAdmin`: quién fija los precios
 * del año que viene no es una decisión de ventas.
 */
export async function priceListRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/price-lists', { preHandler: requireAdmin }, async () => ({
    priceLists: await listarCatalogos(app.prisma),
  }));

  app.post('/admin/price-lists', { preHandler: requireAdmin }, async (req, reply) =>
    conErrores(reply, async () => {
      const priceList = await clonarCatalogo(app.prisma, req.body);
      return reply.code(201).send({ priceList });
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/admin/price-lists/:id/activar',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, async () => ({ priceList: await activarCatalogo(app.prisma, req.params.id) })),
  );

  // --- Editar el CONTENIDO de un catálogo ---
  //
  // Se permite editar cualquier catálogo, incluido uno en uso, por decisión del
  // dueño: eligió la flexibilidad sobre el blindaje sabiendo el costo. Lo que le
  // toca a la API es que la elección sea informada (el impacto) y auditable (la
  // bitácora), no que sea segura por bloqueo.

  /** Cuántas cotizaciones puede represiar editar este catálogo, por estatus. */
  app.get<{ Params: { id: string } }>(
    '/admin/price-lists/:id/impacto',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, async () => ({ impacto: await impactoDeCatalogo(app.prisma, req.params.id) })),
  );

  /** La bitácora del catálogo: quién cambió qué, y cuántas cotizaciones había en riesgo entonces. */
  app.get<{ Params: { id: string } }>(
    '/admin/price-lists/:id/bitacora',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, async () => {
        // Valida que exista antes de devolver una lista vacía por un id inventado.
        await impactoDeCatalogo(app.prisma, req.params.id);
        return { bitacora: await listarBitacoraCatalogo(app.prisma, req.params.id) };
      }),
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/price-lists/:id/rentas',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, () => editarRentas(app.prisma, req.params.id, req.body, req.user as Actor)),
  );

  // --- Servicios ---
  app.post<{ Params: { id: string } }>(
    '/admin/price-lists/:id/servicios',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, async () => {
        const addOn = await crearServicio(app.prisma, req.params.id, req.body, req.user as Actor);
        return reply.code(201).send({ addOn });
      }),
  );

  app.patch<{ Params: { id: string; addOnId: string } }>(
    '/admin/price-lists/:id/servicios/:addOnId',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, async () => ({
        addOn: await editarServicio(
          app.prisma,
          req.params.id,
          req.params.addOnId,
          req.body,
          req.user as Actor,
        ),
      })),
  );

  app.delete<{ Params: { id: string; addOnId: string } }>(
    '/admin/price-lists/:id/servicios/:addOnId',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, () =>
        borrarServicio(app.prisma, req.params.id, req.params.addOnId, req.user as Actor),
      ),
  );

  // --- Paquetes de alimentos ---
  app.post<{ Params: { id: string } }>(
    '/admin/price-lists/:id/paquetes',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, async () => {
        const paquete = await crearPaquete(app.prisma, req.params.id, req.body, req.user as Actor);
        return reply.code(201).send({ paquete });
      }),
  );

  app.patch<{ Params: { id: string; packageId: string } }>(
    '/admin/price-lists/:id/paquetes/:packageId',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, async () => ({
        paquete: await editarPaquete(
          app.prisma,
          req.params.id,
          req.params.packageId,
          req.body,
          req.user as Actor,
        ),
      })),
  );

  app.delete<{ Params: { id: string; packageId: string } }>(
    '/admin/price-lists/:id/paquetes/:packageId',
    { preHandler: requireAdmin },
    async (req, reply) =>
      conErrores(reply, () =>
        borrarPaquete(app.prisma, req.params.id, req.params.packageId, req.user as Actor),
      ),
  );
}
