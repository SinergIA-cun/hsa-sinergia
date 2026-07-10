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
}
