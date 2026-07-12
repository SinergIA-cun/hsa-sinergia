import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';

/** Búsqueda de clientes existentes para reutilizarlos al cotizar (evita
 *  duplicados y números de referencia SPEI repetidos). */
export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>('/clients', { preHandler: requireAuth }, async (req) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return { clients: [] };
    const clients = await app.prisma.client.findMany({
      where: {
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { telefono: { contains: q } },
          { correo: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        nombre: true,
        telefono: true,
        correo: true,
        empresa: true,
        numeroReferencia: true,
      },
      orderBy: { nombre: 'asc' },
      take: 8,
    });
    return { clients };
  });
}
