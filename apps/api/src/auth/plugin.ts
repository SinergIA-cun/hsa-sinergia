import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { COOKIE_NAME } from '../config.js';
import { sellarActor } from '../auditoria/contexto.js';
import { verifyToken } from './jwt.js';

/**
 * Registra un hook onRequest que puebla `request.user` a partir de la cookie
 * (si el token es válido). No bloquea; el bloqueo lo hacen los guards.
 * Se llama directamente sobre la instancia raíz (no vía register) para que el
 * hook aplique a todas las rutas sin problemas de encapsulación.
 */
export function setupAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return;
    const payload = await verifyToken(token, app.config.JWT_SECRET);
    if (!payload) return;
    req.user = { id: payload.sub, role: payload.role };
    // Y también en el contexto que viaja hasta Prisma: es lo que hace que la
    // bitácora forense sepa el nombre de quien hizo el cambio.
    sellarActor(payload.sub);
  });
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    await reply.code(401).send({ error: 'No autenticado' });
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    await reply.code(401).send({ error: 'No autenticado' });
    return;
  }
  if (req.user.role !== 'admin') {
    await reply.code(403).send({ error: 'Requiere rol admin' });
  }
}
