import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth/plugin.js';
import { contratosQueUsan, mensajeEnUso, type UsoEnContratos } from '../quotes/usos.js';

const banqueteroCreateSchema = z.object({
  nombre: z.string().min(1),
  // OBLIGATORIO al dar de alta (decisión del dueño): un banquetero sin teléfono
  // es una contraparte con la que no se puede hablar, y de éstos depende dinero.
  // El correo es opcional.
  telefono: z.string().min(1, 'El teléfono del banquetero es obligatorio').max(40),
  correo: z.string().max(200).nullish(),
});

const banqueteroUpdateSchema = z.object({
  nombre: z.string().min(1).optional(),
  // Al EDITAR sí puede llegar vacío como `null`: es como se corrige un teléfono
  // mal capturado, y los banqueteros que ya existían sin él no se pueden bloquear
  // retroactivamente. La ficha los marca como incompletos.
  telefono: z.string().max(40).nullable().optional(),
  correo: z.string().max(200).nullable().optional(),
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

/**
 * El 409 de "lo usan estos contratos", con la lista.
 *
 * Manda la lista y no solo el número: sin ella el aviso obliga a buscar a mano
 * entre cientos de contratos cuál es el que estorba.
 */
function enUsoPorContratos(reply: import('fastify').FastifyReply, uso: UsoEnContratos): void {
  reply.code(409).send({ error: mensajeEnUso(uso), enUso: uso });
}

/**
 * Administración que NO es del catálogo: banqueteros, personal y cuadrillas.
 *
 * Lo que vivía aquí y ya no:
 *
 * - `/admin/config` editaba los parámetros del catálogo ACTIVO: un segundo
 *   camino al mismo dato. Se retiró; van por `PATCH /admin/price-lists/:id/parametros`.
 * - `/admin/addons` administraba los servicios del catálogo ACTIVO, y era peor
 *   que un simple duplicado por dos cosas concretas: **no escribía nada en
 *   `PriceListAudit`** —un cambio de precio hecho desde ahí no dejaba rastro en
 *   la bitácora del catálogo— y su `PATCH`/`DELETE` operaban por id **sin
 *   comprobar a qué catálogo pertenece el servicio**, así que desde la pantalla
 *   del activo se podía editar o borrar un servicio de 2028. Se retiró; van por
 *   `POST/PATCH/DELETE /admin/price-lists/:id/servicios`, que sí valida la
 *   pertenencia y sí deja bitácora.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
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
    const uso = await contratosQueUsan(app.prisma, { banqueteroId: id });
    if (uso.total > 0) return enUsoPorContratos(reply, uso);
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
