import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, type Actor } from '../quotes/service.js';

/** Tipo de profesional de eventos (reunión del 15-oct-2026): B, BG, A, WP. */

const LLAVE_LEER = 'l'.repeat(64);
let app: FastifyInstance;
let admin: Actor;
let cookie: Record<string, string>;
let banqueteroId: string;
const quotes: string[] = [];

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE_LEER } });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'admin1234' } });
  const c = login.cookies[0]!;
  cookie = { [c.name]: c.value };
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  if (banqueteroId) await prisma.banquetero.delete({ where: { id: banqueteroId } });
  await app.close();
});

describe('tipo de profesional', () => {
  it('se da de alta como wedding planner, se cambia, y el BI lo lee con su código', async () => {
    const alta = await app.inject({
      method: 'POST',
      url: '/api/admin/banqueteros',
      cookies: cookie,
      payload: { nombre: `WP Prueba ${randomUUID().slice(0, 6)}`, tipo: 'weddingPlanner', telefono: '5512121212' },
    });
    expect(alta.statusCode).toBe(201);
    banqueteroId = alta.json().banquetero.id;
    expect(alta.json().banquetero.tipo).toBe('weddingPlanner');
    const malo = await app.inject({ method: 'PATCH', url: `/api/admin/banqueteros/${banqueteroId}`, cookies: cookie, payload: { tipo: 'inventado' } });
    expect(malo.statusCode).toBe(400);

    const arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
    const bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
    const q = await createQuote(prisma, { fecha: '2068-02-04', invitados: 150, spaceIds: [arcosId], eventTypeId: bodaId, banqueteroId, client: { nombre: 'WP Prueba', telefono: '5512121212' } }, admin);
    quotes.push(q.id);
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos?limit=500&desde=2068-02-01&hasta=2068-02-28', headers: { 'x-api-key': LLAVE_LEER } });
    const ev = (r.json().datos as { id: string; banquetero: unknown }[]).find((e) => e.id === q.id);
    expect(ev?.banquetero).toMatchObject({ id: banqueteroId, tipo: 'WP' });
  });
});
