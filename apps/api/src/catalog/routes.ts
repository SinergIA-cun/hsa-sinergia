import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { loadCatalog } from './loader.js';

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  // Catálogo para el wizard del cotizador. Incluye:
  //  - `engine`: el Catalog de @hsa/shared (con matriz de renta) para calcular
  //    el desglose EN VIVO en el navegador con el mismo motor.
  //  - metadata para etiquetas (nombres de espacios, tipos de evento, add-ons).
  app.get('/catalog', { preHandler: requireAuth }, async () => {
    const [engine, spaces, eventTypes, addOns] = await Promise.all([
      loadCatalog(app.prisma),
      app.prisma.space.findMany({
        where: { activo: true },
        include: { paymentRule: true },
        orderBy: { nombre: 'asc' },
      }),
      app.prisma.eventType.findMany({
        include: { foodPackages: { include: { brackets: true } } },
        orderBy: { nombre: 'asc' },
      }),
      // También sin filtrar: el formulario solo OFRECE los `activo: true`, pero
      // necesita poder nombrar uno inactivo que la cotización ya traiga
      // seleccionado. Si se esconde aquí, no hay forma de quitarlo desde la
      // interfaz y la cotización queda ineditable.
      app.prisma.addOn.findMany({ orderBy: { nombre: 'asc' } }),
    ]);
    return { engine, spaces, eventTypes, addOns };
  });
}
