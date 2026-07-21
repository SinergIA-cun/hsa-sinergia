import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth/plugin.js';
import { hashPassword } from '../auth/password.js';

const createUserSchema = z.object({
  nombre: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  role: z.enum(['ventas', 'admin']).default('ventas'),
});

const updateUserSchema = z.object({
  nombre: z.string().min(1).optional(),
  role: z.enum(['ventas', 'admin']).optional(),
  activo: z.boolean().optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').optional(),
});

/** Cuenta cuántos admins activos hay (para no dejar el sistema sin admin). */
async function contarAdminsActivos(prisma: FastifyInstance['prisma']): Promise<number> {
  return prisma.user.count({ where: { role: 'admin', activo: true } });
}

const select = { id: true, nombre: true, email: true, role: true, activo: true, createdAt: true };

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', { preHandler: requireAdmin }, async () => {
    return { users: await app.prisma.user.findMany({ select, orderBy: { createdAt: 'asc' } }) };
  });

  app.post('/users', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Datos inválidos', issues: parsed.error.issues });
    }
    const { nombre, email, password, role } = parsed.data;
    const exists = await app.prisma.user.findUnique({ where: { email } });
    if (exists) return reply.code(409).send({ error: 'Ya existe un usuario con ese correo' });
    const user = await app.prisma.user.create({
      data: { nombre, email, passwordHash: await hashPassword(password), role },
      select,
    });
    return reply.code(201).send({ user });
  });

  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Datos inválidos', issues: parsed.error.issues });
    }
    const { id } = req.params;
    const target = await app.prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'Usuario no encontrado' });

    // No dejar el sistema sin admin: si este es el último admin activo, no se
    // le puede quitar el rol admin ni desactivar.
    const pierdeAdmin =
      target.role === 'admin' &&
      target.activo &&
      ((parsed.data.role && parsed.data.role !== 'admin') || parsed.data.activo === false);
    if (pierdeAdmin && (await contarAdminsActivos(app.prisma)) <= 1) {
      return reply.code(409).send({ error: 'No puedes dejar el sistema sin un admin activo.' });
    }

    const { nombre, role, activo, password } = parsed.data;
    const user = await app.prisma.user.update({
      where: { id },
      data: {
        ...(nombre !== undefined ? { nombre } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(activo !== undefined ? { activo } : {}),
        ...(password !== undefined ? { passwordHash: await hashPassword(password) } : {}),
      },
      select,
    });
    return { user };
  });

  // Borra un usuario sólo si no dejó rastro (contratos, pagos, bitácora); si sí,
  // se sugiere desactivarlo para conservar la trazabilidad histórica.
  app.delete<{ Params: { id: string } }>('/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params;
    if (req.user?.id === id) {
      return reply.code(409).send({ error: 'No puedes borrar tu propia cuenta.' });
    }
    const target = await app.prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'Usuario no encontrado' });

    const [contratos, pagosReg, pagosAnu, actividades] = await Promise.all([
      app.prisma.quote.count({ where: { createdById: id } }),
      app.prisma.payment.count({ where: { registradoById: id } }),
      app.prisma.payment.count({ where: { anuladoById: id } }),
      app.prisma.activityLog.count({ where: { actorId: id } }),
    ]);
    const refs = contratos + pagosReg + pagosAnu + actividades;
    if (refs > 0) {
      return reply.code(409).send({
        error: 'No se puede borrar: el usuario tiene actividad registrada. Desactívalo en vez de borrarlo.',
      });
    }
    if (target.role === 'admin' && target.activo && (await contarAdminsActivos(app.prisma)) <= 1) {
      return reply.code(409).send({ error: 'No puedes borrar al último admin activo.' });
    }

    await app.prisma.user.delete({ where: { id } });
    return reply.code(204).send();
  });
}
