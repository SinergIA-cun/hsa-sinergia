import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  // Catálogo en forma amigable para el wizard del cotizador.
  app.get('/catalog', { preHandler: requireAuth }, async () => {
    const [spaces, eventTypes, addOns, config] = await Promise.all([
      app.prisma.space.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
      app.prisma.eventType.findMany({
        include: { foodPackages: { include: { brackets: true } }, paymentRule: true },
        orderBy: { nombre: 'asc' },
      }),
      app.prisma.addOn.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
      app.prisma.pricingConfig.findUnique({ where: { id: 'default' } }),
    ]);
    return { spaces, eventTypes, addOns, config };
  });
}
