import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@hsa/database';
import { requireAdmin } from '../auth/plugin.js';

/**
 * Proveedores de los servicios del catálogo (mesa de dulces, grupo, cabina…).
 * Son globales —no por catálogo— y su `id` es la clave fija que ve el BI. No se
 * borran: se desactivan, porque los servicios de catálogos viejos los siguen
 * nombrando.
 */
const nombre = z.string().trim().min(1, 'Pon el nombre del proveedor').max(80);
const telefono = z
  .string()
  .trim()
  .max(30)
  .transform((v) => (v === '' ? null : v))
  .nullish();

const crearSchema = z.object({ nombre, telefono });
const editarSchema = z
  .object({ nombre: nombre.optional(), telefono, activo: z.boolean().optional() })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'No hay nada que cambiar' });

const select = { id: true, nombre: true, telefono: true, activo: true, createdAt: true } as const;

/** El nombre es único: dos "Dulces Lupita" partirían sus servicios en dos. La
 *  base lo exige exacto; aquí se revisa sin mayúsculas, para avisar antes. */
const esDuplicado = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function proveedorRoutes(app: FastifyInstance): Promise<void> {
  const nombreTomado = async (n: string, salvo?: string) =>
    (await app.prisma.proveedor.count({
      where: { nombre: { equals: n, mode: 'insensitive' }, ...(salvo ? { id: { not: salvo } } : {}) },
    })) > 0;
  const DUPLICADO = { error: 'Ya existe un proveedor con ese nombre' };

  app.get('/admin/proveedores', { preHandler: requireAdmin }, async () => ({
    proveedores: await app.prisma.proveedor.findMany({
      select: { ...select, _count: { select: { servicios: true } } },
      orderBy: { nombre: 'asc' },
    }),
  }));

  app.post('/admin/proveedores', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = crearSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos', issues: parsed.error.issues });
    if (await nombreTomado(parsed.data.nombre)) return reply.code(409).send(DUPLICADO);
    try {
      const proveedor = await app.prisma.proveedor.create({ data: parsed.data, select });
      return reply.code(201).send({ proveedor });
    } catch (e) {
      if (esDuplicado(e)) return reply.code(409).send(DUPLICADO);
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>('/admin/proveedores/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = editarSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos', issues: parsed.error.issues });
    const existe = await app.prisma.proveedor.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existe) return reply.code(404).send({ error: 'Proveedor no encontrado' });
    if (parsed.data.nombre && (await nombreTomado(parsed.data.nombre, req.params.id))) return reply.code(409).send(DUPLICADO);
    try {
      const proveedor = await app.prisma.proveedor.update({ where: { id: req.params.id }, data: parsed.data, select });
      return { proveedor };
    } catch (e) {
      if (esDuplicado(e)) return reply.code(409).send(DUPLICADO);
      throw e;
    }
  });
}
