import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/plugin.js';
import { consultaSchema, detalleAuditoria, listarAuditoria } from './consulta.js';

/**
 * La bitácora forense, de solo lectura y solo para admin.
 *
 * No hay ruta para escribir ni para borrar a propósito: la escriben los triggers
 * de Postgres y un trigger de solo escritura impide editarla. Si algún día
 * aparece aquí un POST, la bitácora dejó de ser bitácora.
 */
export async function auditoriaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/auditoria', { preHandler: requireAdmin }, async (req) => {
    const q = consultaSchema.parse(req.query ?? {});
    return listarAuditoria(app.prisma, q);
  });

  app.get<{ Params: { id: string } }>(
    '/admin/auditoria/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      let id: bigint;
      try {
        id = BigInt(req.params.id);
      } catch {
        return reply.code(400).send({ error: 'Id inválido' });
      }
      const detalle = await detalleAuditoria(app.prisma, id);
      if (!detalle) return reply.code(404).send({ error: 'No encontrado' });
      return detalle;
    },
  );
}
