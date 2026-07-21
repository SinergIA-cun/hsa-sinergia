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

const empleadoCreateSchema = z.object({
  nombre: z.string().min(1),
  rol: z.string().max(60).optional(),
});
const empleadoUpdateSchema = z.object({
  nombre: z.string().min(1).optional(),
  rol: z.string().max(60).nullable().optional(),
  activo: z.boolean().optional(),
});

const cuadrillaCreateSchema = z.object({
  nombre: z.string().min(1),
  empleadoIds: z.array(z.string()).default([]),
});
const cuadrillaUpdateSchema = z.object({
  nombre: z.string().min(1).optional(),
  activo: z.boolean().optional(),
  empleadoIds: z.array(z.string()).optional(),
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

  // --- Empleados (personal HSA) ---
  app.get('/empleados', { preHandler: requireAuth }, async () => ({
    empleados: await app.prisma.empleado.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
  }));

  app.get('/admin/empleados', { preHandler: requireAdmin }, async () => ({
    empleados: await app.prisma.empleado.findMany({ orderBy: { nombre: 'asc' } }),
  }));

  app.post('/admin/empleados', { preHandler: requireAdmin }, async (req, reply) => {
    const data = empleadoCreateSchema.parse(req.body);
    const empleado = await app.prisma.empleado.create({ data });
    return reply.code(201).send({ empleado });
  });

  app.patch<{ Params: { id: string } }>('/admin/empleados/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const data = empleadoUpdateSchema.parse(req.body);
    try {
      const empleado = await app.prisma.empleado.update({ where: { id: req.params.id }, data });
      return { empleado };
    } catch {
      return reply.code(404).send({ error: 'Empleado no encontrado' });
    }
  });

  // --- Cuadrillas (grupos de empleados) ---
  const cuadrillaInclude = {
    miembros: { include: { empleado: { select: { id: true, nombre: true, rol: true } } } },
  } as const;

  app.get('/cuadrillas', { preHandler: requireAuth }, async () => ({
    cuadrillas: await app.prisma.cuadrilla.findMany({
      where: { activo: true },
      include: cuadrillaInclude,
      orderBy: { nombre: 'asc' },
    }),
  }));

  app.get('/admin/cuadrillas', { preHandler: requireAdmin }, async () => ({
    cuadrillas: await app.prisma.cuadrilla.findMany({ include: cuadrillaInclude, orderBy: { nombre: 'asc' } }),
  }));

  app.post('/admin/cuadrillas', { preHandler: requireAdmin }, async (req, reply) => {
    const data = cuadrillaCreateSchema.parse(req.body);
    const cuadrilla = await app.prisma.cuadrilla.create({
      data: {
        nombre: data.nombre,
        miembros: { create: data.empleadoIds.map((empleadoId) => ({ empleadoId })) },
      },
      include: cuadrillaInclude,
    });
    return reply.code(201).send({ cuadrilla });
  });

  app.patch<{ Params: { id: string } }>('/admin/cuadrillas/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const data = cuadrillaUpdateSchema.parse(req.body);
    try {
      // Si llegan empleadoIds, se reemplazan los miembros por completo.
      if (data.empleadoIds) {
        await app.prisma.cuadrillaMiembro.deleteMany({ where: { cuadrillaId: req.params.id } });
        await app.prisma.cuadrillaMiembro.createMany({
          data: data.empleadoIds.map((empleadoId) => ({ cuadrillaId: req.params.id, empleadoId })),
        });
      }
      const cuadrilla = await app.prisma.cuadrilla.update({
        where: { id: req.params.id },
        data: { nombre: data.nombre, activo: data.activo },
        include: cuadrillaInclude,
      });
      return { cuadrilla };
    } catch {
      return reply.code(404).send({ error: 'Cuadrilla no encontrada' });
    }
  });
}
