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
  kind: z.enum(['fijo', 'porPersona', 'porUnidad']).optional(),
  price: z.number().int().nonnegative().optional(),
  activo: z.boolean().optional(),
});

/** Mensaje 409 estándar cuando un registro está referenciado y no se puede borrar. */
function enUso(reply: import('fastify').FastifyReply, entidad: string, n: number): void {
  reply.code(409).send({
    error: `No se puede borrar: en uso por ${n} ${entidad}. Desactívalo en vez de borrarlo.`,
  });
}

/**
 * El catálogo activo. Es el que administra la pantalla de servicios.
 *
 * Los PARÁMETROS ya no se editan aquí: `/admin/config` los escribía sobre el
 * catálogo activo y era un segundo camino al mismo dato, la clase de duplicidad
 * que el Plan E vino a eliminar. Se retiró; ahora se editan con
 * `PATCH /admin/price-lists/:id/parametros`, sobre el catálogo que se elija.
 */
function catalogoActivo(app: FastifyInstance) {
  return app.prisma.priceList.findFirst({ where: { activa: true }, orderBy: { anio: 'desc' } });
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Los servicios ahora pertenecen a un catálogo; esta pantalla administra los
  // del ACTIVO. Editar los de cualquier otro catálogo va por
  // `/admin/price-lists/:id/servicios`.
  app.get('/admin/addons', { preHandler: requireAdmin }, async () => ({
    addOns: await app.prisma.addOn.findMany({
      where: { priceList: { activa: true } },
      orderBy: { nombre: 'asc' },
    }),
  }));

  app.post('/admin/addons', { preHandler: requireAdmin }, async (req, reply) => {
    const data = addonCreateSchema.parse(req.body);
    const activo = await catalogoActivo(app);
    if (!activo) return reply.code(409).send({ error: 'No hay catálogo activo' });
    const addOn = await app.prisma.addOn.create({ data: { ...data, priceListId: activo.id } });
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

  // Borra un extra sólo si ningún contrato lo referencia en su JSON de add-ons.
  app.delete<{ Params: { id: string } }>('/admin/addons/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params;
    const rows = await app.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM "Quote" WHERE "addOns" @> ${JSON.stringify([{ addOnId: id }])}::jsonb`;
    const n = rows[0]?.count ?? 0;
    if (n > 0) return enUso(reply, n === 1 ? 'contrato' : 'contratos', n);
    try {
      await app.prisma.addOn.delete({ where: { id } });
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'Add-on no encontrado' });
    }
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

  // Borra un banquetero sólo si no está asignado a ningún contrato (activo o en papelera).
  app.delete<{ Params: { id: string } }>('/admin/banqueteros/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params;
    const n = await app.prisma.quote.count({ where: { banqueteroId: id } });
    if (n > 0) return enUso(reply, n === 1 ? 'contrato' : 'contratos', n);
    try {
      await app.prisma.banquetero.delete({ where: { id } });
      return reply.code(204).send();
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

  // El empleado no tiene FK con contratos (el personal HSA se guarda como texto);
  // sus membresías en cuadrillas se eliminan por cascade.
  app.delete<{ Params: { id: string } }>('/admin/empleados/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      await app.prisma.empleado.delete({ where: { id: req.params.id } });
      return reply.code(204).send();
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

  // Borra la cuadrilla; sus miembros (CuadrillaMiembro) caen por cascade.
  app.delete<{ Params: { id: string } }>('/admin/cuadrillas/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      await app.prisma.cuadrilla.delete({ where: { id: req.params.id } });
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'Cuadrilla no encontrada' });
    }
  });
}
