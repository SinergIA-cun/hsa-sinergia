import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { prisma, type PrismaClient } from '@hsa/database';
import { ZodError } from 'zod';
import { loadConfig, type AppConfig } from './config.js';
import { setupAuth } from './auth/plugin.js';
import { authRoutes } from './auth/routes.js';
import { catalogRoutes } from './catalog/routes.js';
import { quoteRoutes } from './quotes/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
  }
  interface FastifyRequest {
    user?: { id: string; role: 'vendedora' | 'admin' };
  }
}

export interface BuildOptions {
  config?: AppConfig;
  db?: PrismaClient;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const db = opts.db ?? prisma;

  const app = Fastify({ logger: false });
  app.decorate('config', config);
  app.decorate('prisma', db);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: [config.PUBLIC_WEB_URL], credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

  setupAuth(app);

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Datos inválidos', issues: error.issues });
    }
    const message = error instanceof Error ? error.message : 'Error interno';
    if (reply.statusCode < 400) reply.code(500);
    return reply.send({ error: message });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(catalogRoutes);
  await app.register(quoteRoutes);

  return app;
}
