import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { prisma, type PrismaClient } from '@hsa/database';
import { ZodError } from 'zod';
import { loadConfig, type AppConfig } from './config.js';
import { setupAuth } from './auth/plugin.js';
import { setupContextoActor } from './auditoria/contexto.js';
import { authRoutes } from './auth/routes.js';
import { catalogRoutes } from './catalog/routes.js';
import { quoteRoutes } from './quotes/routes.js';
import { cicloRoutes } from './quotes/cicloRoutes.js';
import { userRoutes } from './users/routes.js';
import { availabilityRoutes } from './availability/routes.js';
import { paymentRoutes } from './payments/routes.js';
import { cargoRoutes } from './cargos/routes.js';
import { devolucionRoutes } from './devoluciones/routes.js';
import { adminRoutes } from './admin/routes.js';
import { priceListRoutes } from './pricelists/routes.js';
import { clientRoutes } from './clients/routes.js';
import { dashboardRoutes } from './dashboard/routes.js';
import { biRoutes } from './bi/routes.js';
import { banqueteroRoutes } from './banqueteros/routes.js';
import { auditoriaRoutes } from './auditoria/routes.js';
import { historicoRoutes } from './historico/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
  }
  interface FastifyRequest {
    user?: { id: string; role: 'ventas' | 'admin' };
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
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

  // El orden importa: primero se abre el contexto de la petición, luego la
  // autenticación lo llena con el usuario del token.
  setupContextoActor(app);
  setupAuth(app);

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Datos inválidos', issues: error.issues });
    }
    // Los errores de Fastify traen su código: un cuerpo vacío o un JSON mal
    // formado es un 400 del que llama, no un 500 nuestro. Antes todo lo que no
    // fuera Zod salía como 500, y a quien integra (el BI) le decía "se cayó el
    // servidor" cuando el error era suyo.
    const status = (error as { statusCode?: number }).statusCode ?? (reply.statusCode >= 400 ? reply.statusCode : 500);
    if (status < 500) {
      return reply.code(status).send({ error: error instanceof Error ? error.message : 'Solicitud inválida' });
    }
    // Un 500 sí es nuestro: se registra completo y al cliente no se le enseña el
    // mensaje interno (puede traer detalles de la base).
    req.log.error(error);
    return reply.code(status).send({ error: 'Error interno del servidor' });
  });

  // /health en la raíz para healthchecks de infraestructura.
  app.get('/health', async () => ({ ok: true }));

  // Todas las rutas de la app bajo /api (así el front puede tener su propia
  // página /c/:token sin chocar con el JSON de la API).
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(catalogRoutes, { prefix: '/api' });
  await app.register(quoteRoutes, { prefix: '/api' });
  await app.register(cicloRoutes, { prefix: '/api' });
  await app.register(userRoutes, { prefix: '/api' });
  await app.register(availabilityRoutes, { prefix: '/api' });
  await app.register(paymentRoutes, { prefix: '/api' });
  await app.register(cargoRoutes, { prefix: '/api' });
  await app.register(devolucionRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api' });
  await app.register(priceListRoutes, { prefix: '/api' });
  await app.register(clientRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.register(biRoutes, { prefix: '/api' });
  await app.register(banqueteroRoutes, { prefix: '/api' });
  await app.register(auditoriaRoutes, { prefix: '/api' });
  await app.register(historicoRoutes, { prefix: '/api' });

  return app;
}
