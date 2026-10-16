import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@hsa/database';
import { MARCA_POR_OMISION } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, type Actor } from '../quotes/service.js';
import type { Mailer, Mensaje } from '../correos/mailer.js';
import { barrerApartados, crearApartado, apartadosPorVencer, fijarTope } from './service.js';

/** Apartados rápidos con fila de espera (Jorge, 15-oct-2026). */

let app: FastifyInstance;
let admin: Actor;
let ventas: Actor;
let cookie: Record<string, string>;
let bodaId: string;
let arcosId: string;
const DIA = 24 * 60 * 60 * 1000;

let n = 0;
const fecha = () => new Date(Date.UTC(2062, 0, 7 + 7 * n++)).toISOString().slice(0, 10);
const tel = (i: number) => `55${String(10_000_000 + i).padStart(8, '0')}`;

function buzon(): Mailer & { enviados: Mensaje[] } {
  const enviados: Mensaje[] = [];
  return { enviados, async send(m) { enviados.push(m); } };
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const v = await prisma.user.upsert({
    where: { email: 'ventas-apartados@test.local' },
    create: { email: 'ventas-apartados@test.local', nombre: 'Ventas Apartados', passwordHash: 'x', role: 'ventas' },
    update: {},
  });
  ventas = { id: v.id, role: 'ventas' };
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'admin1234' } });
  const c = login.cookies[0]!;
  cookie = { [c.name]: c.value };
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
});

afterAll(async () => {
  await prisma.apartadoRapido.deleteMany({ where: { fecha: { gte: new Date('2062-01-01'), lt: new Date('2063-01-01') } } });
  await fijarTope(prisma, { tope: 10 }, admin);
  await prisma.user.deleteMany({ where: { email: 'ventas-apartados@test.local' } });
  await app.close();
});

const nuevo = (f: string, i: number, actor: Actor = admin) =>
  crearApartado(prisma, { nombre: `Persona ${i}`, telefono: tel(i), eventTypeId: bodaId, fecha: f }, actor);

describe('la fila de un día', () => {
  it('hacen fila en orden de llegada hasta el tope; no repite teléfono', async () => {
    await fijarTope(prisma, { tope: 5 }, admin);
    const f = fecha();
    const creados = [];
    for (let i = 1; i <= 5; i++) creados.push(await nuevo(f, i));
    expect(creados.map((a) => a.posicion)).toEqual([1, 2, 3, 4, 5]);
    expect(creados[0]).toMatchObject({ diasRestantes: 15, porVencer: false });
    await expect(nuevo(f, 6)).rejects.toMatchObject({ status: 409 });
    await fijarTope(prisma, { tope: 6 }, admin);
    await expect(nuevo(f, 1)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/ya está en la fila/) });
    expect((await nuevo(f, 6)).posicion).toBe(6);
  });

  it('el tope va de 5 a 10 y solo lo cambia un admin', async () => {
    await expect(fijarTope(prisma, { tope: 4 }, admin)).rejects.toThrow();
    await expect(fijarTope(prisma, { tope: 11 }, admin)).rejects.toThrow();
    await expect(fijarTope(prisma, { tope: 7 }, ventas)).rejects.toMatchObject({ status: 403 });
    const r = await app.inject({ method: 'PUT', url: '/api/apartados-rapidos/tope', cookies: cookie, payload: { tope: 8 } });
    expect(r.json()).toEqual({ tope: 8 });
  });

  it('una fecha pasada no se aparta', async () => {
    await expect(crearApartado(prisma, { nombre: 'Atrasado', telefono: tel(90), eventTypeId: bodaId, fecha: '2020-01-01' }, admin)).rejects.toMatchObject({ status: 400 });
  });
});

describe('confirmar, liberar y convertir', () => {
  it('confirmar da otros 15 días; liberar sube al siguiente; un vendedor no toca lo ajeno', async () => {
    await fijarTope(prisma, { tope: 10 }, admin);
    const f = fecha();
    const a = await nuevo(f, 11);
    const b = await nuevo(f, 12, ventas);
    const otro = await app.inject({ method: 'POST', url: `/api/apartados-rapidos/${b.id}/confirmar`, cookies: cookie });
    expect(otro.statusCode).toBe(200); // el admin sí puede
    await prisma.apartadoRapido.update({ where: { id: a.id }, data: { vence: new Date(Date.now() + 2 * DIA) } });

    const lib = await app.inject({ method: 'POST', url: `/api/apartados-rapidos/${a.id}/liberar`, cookies: cookie, payload: { motivo: 'Ya no le interesa' } });
    expect(lib.statusCode).toBe(200);
    const lista = await app.inject({ method: 'GET', url: `/api/apartados-rapidos?from=${f}&to=${f}`, cookies: cookie });
    expect(lista.json().apartados).toEqual([expect.objectContaining({ id: b.id, posicion: 1, extensiones: 1 })]);
  });

  it('convertir lo cierra ligado al evento', async () => {
    const f = fecha();
    const a = await nuevo(f, 21);
    const q = await prisma.quote.findFirstOrThrow({ where: { client: { telefono: { not: null } } }, select: { id: true } });
    const r = await app.inject({ method: 'POST', url: `/api/apartados-rapidos/${a.id}/convertir`, cookies: cookie, payload: { quoteId: q.id } });
    expect(r.statusCode).toBe(200);
    expect(await prisma.apartadoRapido.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ estado: 'convertido', quoteId: q.id });
    // Para no dejar amarrado un evento ajeno a la prueba.
    await prisma.apartadoRapido.update({ where: { id: a.id }, data: { quoteId: null } });
  });
});

describe('teléfono opcional en el apartado, obligatorio al convertir (reunión del 15-oct-2026)', () => {
  it('se aparta sin teléfono; no se convierte en un evento sin teléfono', async () => {
    const f = fecha();
    const a = await crearApartado(prisma, { nombre: 'Sin Teléfono', telefono: '', eventTypeId: bodaId, fecha: f }, admin);
    expect(a.telefono).toBeNull();
    const b = await crearApartado(prisma, { nombre: 'Otro Sin Teléfono', eventTypeId: bodaId, fecha: f }, admin);
    expect(b.posicion).toBe(2);
    const sinTel = await createQuote(
      prisma,
      { fecha: f, invitados: 150, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Sin Teléfono', correo: 'sintel@example.com' } },
      admin,
    );
    const r = await app.inject({ method: 'POST', url: `/api/apartados-rapidos/${a.id}/convertir`, cookies: cookie, payload: { quoteId: sinTel.id } });
    expect(r.statusCode).toBe(409);
    await prisma.activityLog.deleteMany({ where: { quoteId: sinTel.id } });
    await prisma.quote.delete({ where: { id: sinTel.id } });
    await prisma.client.delete({ where: { id: sinTel.clientId } });
  });
});

describe('el barrido: aviso a 3 días y liberación al vencer', () => {
  it('avisa una vez al vendedor y a los admins, y al vencer libera solo', async () => {
    const f = fecha();
    const a = await nuevo(f, 31, ventas);
    const correo = buzon();
    const ahora = new Date();

    // Día 12: entra al aviso.
    await prisma.apartadoRapido.update({ where: { id: a.id }, data: { vence: new Date(ahora.getTime() + 2.5 * DIA) } });
    const r1 = await barrerApartados(prisma, correo, MARCA_POR_OMISION, 'https://hsa.example', ahora);
    expect(r1.avisos).toBeGreaterThanOrEqual(1);
    const suyos = correo.enviados.filter((m) => m.subject.includes('Persona 31'));
    expect(suyos.map((m) => m.to)).toEqual(expect.arrayContaining(['ventas-apartados@test.local', 'admin@haciendasanandres.com.mx']));
    expect((await apartadosPorVencer(prisma, ventas, ahora)).apartados.map((x) => x.id)).toContain(a.id);

    // Otra vuelta no repite el correo.
    const antes = correo.enviados.length;
    await barrerApartados(prisma, correo, MARCA_POR_OMISION, 'https://hsa.example', ahora);
    expect(correo.enviados.filter((m) => m.subject.includes('Persona 31')).length).toBe(suyos.length);
    expect(correo.enviados.length).toBeGreaterThanOrEqual(antes);

    // Día 15: se libera solo.
    const r3 = await barrerApartados(prisma, null, MARCA_POR_OMISION, 'https://hsa.example', new Date(ahora.getTime() + 3 * DIA));
    expect(r3.liberados).toBeGreaterThanOrEqual(1);
    expect(await prisma.apartadoRapido.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ estado: 'liberado', cerradoById: null });
  });
});

describe('al cotizar, la fila solo avisa', () => {
  it('la disponibilidad dice cuántos hay en fila sin bloquear', async () => {
    const f = fecha();
    await nuevo(f, 41);
    await nuevo(f, 42);
    const r = await app.inject({ method: 'GET', url: `/api/availability?fecha=${f}&spaceIds=${arcosId}`, cookies: cookie });
    expect(r.json()).toMatchObject({ blocked: false, filaEspera: { total: 2, primero: 'Persona 41' } });
  });
});
