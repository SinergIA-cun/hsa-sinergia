import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, type Actor } from './service.js';

/** La comisión de HSA del paquete: del cliente o agencia, o del evento (21-oct-2026). */

let app: FastifyInstance;
let admin: Actor;
let cookie: Record<string, string>;
let arcosId: string;
let bodaId: string;
let paqueteId: string;
const quotes: string[] = [];
const banqueteros: string[] = [];

beforeAll(async () => {
  app = await buildServer({ config: loadConfig(), mailer: null });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'admin1234' } });
  const c = login.cookies[0]!;
  cookie = { [c.name]: c.value };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  const activo = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
  paqueteId = (await prisma.foodPackage.findFirstOrThrow({ where: { priceListId: activo.id, eventTypeId: bodaId } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.flatMap((q) => (q.clientId ? [q.clientId] : [])) } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: banqueteros } } });
  await app.close();
});

let semana = 0;
const sabado = () => new Date(Date.UTC(2071, 0, 3 + 7 * semana++)).toISOString().slice(0, 10);

async function evento(extra: Record<string, unknown> = {}) {
  const q = await createQuote(
    prisma,
    { fecha: sabado(), invitados: 150, spaceIds: [arcosId], eventTypeId: bodaId, foodPackageId: paqueteId, client: { nombre: 'Comisión', telefono: '5512340000' }, ...extra },
    admin,
  );
  quotes.push(q.id);
  return q;
}
const detalle = async (id: string) => (await app.inject({ method: 'GET', url: `/api/quotes/${id}`, cookies: cookie })).json();
const cambiar = (id: string, comisionPct: number) =>
  app.inject({ method: 'PATCH', url: `/api/quotes/${id}/comision`, cookies: cookie, payload: { comisionPct } });

describe('comisión de HSA', () => {
  it('sin cliente ni agencia vive en el evento: nace en 10% y se cambia', async () => {
    const q = await evento();
    expect((await detalle(q.id)).paquete.comision).toMatchObject({ pct: 10, fuente: 'evento', de: null });
    expect((await cambiar(q.id, 8)).statusCode).toBe(200);
    const c = (await detalle(q.id)).paquete.comision;
    expect(c).toMatchObject({ pct: 8, fuente: 'evento' });
    expect(c.monto).toBeGreaterThan(0);
    expect((await cambiar(q.id, 101)).statusCode).toBe(400);
  });

  it('con cliente profesional manda la de su ficha y en el evento no se cambia', async () => {
    const ban = await prisma.banquetero.create({ data: { nombre: 'Agencia comisión', telefono: '5519191919', tipo: 'agencia', comisionPct: 12 } });
    banqueteros.push(ban.id);
    const q = await evento({ banqueteroId: ban.id });
    expect((await detalle(q.id)).paquete.comision).toMatchObject({ pct: 12, fuente: 'cliente', de: 'Agencia comisión' });
    expect((await cambiar(q.id, 5)).statusCode).toBe(409);
  });
});
