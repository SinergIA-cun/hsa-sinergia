import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../auth/plugin.js';
import { consultaSchema, detalleHistorico, listarHistorico } from './consulta.js';
import { barridoHistorico } from './archivar.js';

/**
 * El archivo de eventos, de solo lectura.
 *
 * Lo puede consultar cualquiera del equipo: saber qué se hizo el año pasado en La
 * Cúpula, con qué menú y con cuánta gente, es trabajo de ventas tanto como de
 * administración. Lo único de admin es forzar el barrido, que es mantenimiento.
 */
export async function historicoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/historico', { preHandler: requireAuth }, async (req) => {
    const q = consultaSchema.parse(req.query ?? {});
    return listarHistorico(app.prisma, q);
  });

  app.get<{ Params: { id: string } }>(
    '/historico/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const detalle = await detalleHistorico(app.prisma, req.params.id);
      if (!detalle) return reply.code(404).send({ error: 'No encontrado' });
      return detalle;
    },
  );

  // Bajo demanda: aquí no hay planificador, y esperar al siguiente reinicio del
  // contenedor para archivar el fin de semana que acaba de pasar no es razonable.
  app.post('/admin/historico/barrer', { preHandler: requireAdmin }, async () =>
    barridoHistorico(app.prisma),
  );
}
