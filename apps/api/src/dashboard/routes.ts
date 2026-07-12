import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { getDashboard } from './service.js';
import type { Actor } from '../quotes/service.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', { preHandler: requireAuth }, async (req) => {
    return getDashboard(app.prisma, req.user as Actor);
  });
}
