import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COOKIE_NAME } from '../config.js';
import { verifyPassword } from './password.js';
import { signToken } from './jwt.js';
import { requireAuth } from './plugin.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Datos inválidos' });
    }
    const { email, password } = parsed.data;
    const user = await app.prisma.user.findUnique({ where: { email } });
    if (!user || !user.activo || !(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send({ error: 'Credenciales inválidas' });
    }
    const token = await signToken({ sub: user.id, role: user.role }, app.config.JWT_SECRET);
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.config.COOKIE_SECURE,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return { user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role } };
  });

  app.post('/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const user = await app.prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return { user: null };
    return { user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role } };
  });
}
