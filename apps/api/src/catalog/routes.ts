import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { loadCatalog } from './loader.js';

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  // Catálogo para el wizard del cotizador. Incluye:
  //  - `engine`: el Catalog de @hsa/shared (con matriz de renta) para calcular
  //    el desglose EN VIVO en el navegador con el mismo motor.
  //  - metadata para etiquetas (nombres de espacios, tipos de evento, add-ons).
  /**
   * Los catálogos entre los que se puede cotizar, con lo justo para elegir uno.
   *
   * Existe porque quien cotiza es VENTAS y `GET /admin/price-lists` es de admin.
   * Y hace falta elegir: la operación no cotiza con "el catálogo activo hoy",
   * cotiza con el del AÑO DEL EVENTO —alguien que pide 2028 en septiembre de
   * 2026 tiene que ver precios de 2028—. Devuelve solo nombre, año y cuál es el
   * activo: para escoger no hacen falta los precios, y los precios de un
   * catálogo son información de la dirección.
   */
  app.get('/price-lists', { preHandler: requireAuth }, async () => ({
    priceLists: await app.prisma.priceList.findMany({
      orderBy: [{ anio: 'asc' }, { nombre: 'asc' }],
      select: { id: true, nombre: true, anio: true, activa: true },
    }),
  }));

  app.get<{ Querystring: { priceListId?: string } }>('/catalog', { preHandler: requireAuth }, async (req) => {
    const { priceListId } = req.query;
    // El catálogo pedido, o el activo. Con el invariante de "un solo activo",
    // `{ priceList: { activa: true } }` apunta al mismo que resuelve el loader.
    const delCatalogo = priceListId ? { priceListId } : { priceList: { activa: true } };
    const [engine, spaces, eventTypes, addOns] = await Promise.all([
      // Con `priceListId` se pide el catálogo de una cotización ya emitida; sin
      // él, el activo (que es el que ofrece el cotizador para lo nuevo).
      loadCatalog(app.prisma, priceListId ? { priceListId } : {}),
      // SIN filtrar por `activo`, por la misma razón que los add-ons de abajo:
      // el catálogo tiene que RESOLVER un espacio dado de baja que una
      // cotización ya emitida referencia por id, o el contrato imprime el cuid
      // crudo (fue el bug de La Capilla). Los espacios salen con su bandera
      // `activo` para que el selector solo OFREZCA los vigentes.
      app.prisma.space.findMany({
        include: { paymentRule: true },
        orderBy: { nombre: 'asc' },
      }),
      app.prisma.eventType.findMany({
        // Los paquetes de alimentos también viven en el catálogo: sin este
        // filtro, clonar un catálogo duplicaría los paquetes del formulario.
        include: { foodPackages: { where: delCatalogo, include: { brackets: true } } },
        orderBy: { nombre: 'asc' },
      }),
      // Del catálogo, pero sin filtrar por `activo`: el formulario solo OFRECE
      // los `activo: true`, pero necesita poder nombrar uno inactivo que la
      // cotización ya traiga seleccionado. Si se esconde aquí, no hay forma de
      // quitarlo desde la interfaz y la cotización queda ineditable.
      app.prisma.addOn.findMany({ where: delCatalogo, orderBy: { nombre: 'asc' } }),
    ]);
    return { engine, spaces, eventTypes, addOns };
  });
}
