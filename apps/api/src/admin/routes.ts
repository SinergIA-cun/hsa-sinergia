import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth/plugin.js';

const banqueteroCreateSchema = z.object({
  nombre: z.string().min(1),
  telefono: z.string().max(40).optional(),
});

const banqueteroUpdateSchema = z.object({
  nombre: z.string().min(1).optional(),
  telefono: z.string().max(40).nullable().optional(),
  activo: z.boolean().optional(),
});

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

  // --- Banqueteros ---
  // Lista para el dropdown de la hoja operativa (cualquier usuario autenticado).
  app.get('/banqueteros', { preHandler: requireAuth }, async () => ({
    banqueteros: await app.prisma.banquetero.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    }),
  }));

  app.get('/admin/banqueteros', { preHandler: requireAdmin }, async () => ({
    banqueteros: await app.prisma.banquetero.findMany({ orderBy: { nombre: 'asc' } }),
  }));

  app.post('/admin/banqueteros', { preHandler: requireAdmin }, async (req, reply) => {
    const data = banqueteroCreateSchema.parse(req.body);
    const banquetero = await app.prisma.banquetero.create({ data });
    return reply.code(201).send({ banquetero });
  });

  app.patch<{ Params: { id: string } }>('/admin/banqueteros/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const data = banqueteroUpdateSchema.parse(req.body);
    try {
      const banquetero = await app.prisma.banquetero.update({ where: { id: req.params.id }, data });
      return { banquetero };
    } catch {
      return reply.code(404).send({ error: 'Banquetero no encontrado' });
    }
  });

  // Ventas por banquetero: número de eventos y monto total (contratos no eliminados).
  app.get('/admin/banqueteros/ventas', { preHandler: requireAdmin }, async () => {
    const [grupos, banqueteros] = await Promise.all([
      app.prisma.quote.groupBy({
        by: ['banqueteroId'],
        where: { banqueteroId: { not: null }, deletedAt: null },
        _count: { _all: true },
        _sum: { total: true, rentaTotal: true, invitados: true },
      }),
      app.prisma.banquetero.findMany(),
    ]);
    const nombreById = new Map(banqueteros.map((b) => [b.id, b.nombre]));
    const ventas = grupos
      .map((g) => ({
        banqueteroId: g.banqueteroId!,
        nombre: nombreById.get(g.banqueteroId!) ?? 'Banquetero',
        eventos: g._count._all,
        totalContratos: g._sum.total ?? 0,
        totalRenta: g._sum.rentaTotal ?? 0,
        invitados: g._sum.invitados ?? 0,
      }))
      .sort((a, b) => b.eventos - a.eventos);
    return { ventas };
  });
}
