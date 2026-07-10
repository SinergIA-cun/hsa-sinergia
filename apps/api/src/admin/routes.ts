import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth/plugin.js';

const addonCreateSchema = z.object({
  nombre: z.string().min(1),
  kind: z.enum(['fijo', 'porPersona', 'porUnidad']),
  price: z.number().int().nonnegative(),
});

const addonUpdateSchema = z.object({
  nombre: z.string().min(1).optional(),
  price: z.number().int().nonnegative().optional(),
  activo: z.boolean().optional(),
});

const configSchema = z.object({
  ivaRate: z.number().min(0).max(1).optional(),
  extraHourRate: z.number().min(0).max(1).optional(),
  foodDiscountRate: z.number().min(0).max(1).optional(),
  valetRatio: z.number().positive().optional(),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/addons', { preHandler: requireAdmin }, async () => ({
    addOns: await app.prisma.addOn.findMany({ orderBy: { nombre: 'asc' } }),
  }));

  app.post('/admin/addons', { preHandler: requireAdmin }, async (req, reply) => {
    const data = addonCreateSchema.parse(req.body);
    const addOn = await app.prisma.addOn.create({ data });
    return reply.code(201).send({ addOn });
  });

  app.patch<{ Params: { id: string } }>('/admin/addons/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const data = addonUpdateSchema.parse(req.body);
    try {
      const addOn = await app.prisma.addOn.update({ where: { id: req.params.id }, data });
      return { addOn };
    } catch {
      return reply.code(404).send({ error: 'Add-on no encontrado' });
    }
  });

  app.get('/admin/config', { preHandler: requireAdmin }, async () => ({
    config: await app.prisma.pricingConfig.findUnique({ where: { id: 'default' } }),
  }));

  app.patch('/admin/config', { preHandler: requireAdmin }, async (req) => {
    const data = configSchema.parse(req.body);
    const config = await app.prisma.pricingConfig.update({ where: { id: 'default' }, data });
    return { config };
  });
}
