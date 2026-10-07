import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, type Actor } from '../quotes/service.js';
import { registerPayment, anularPayment } from './service.js';
import { ServerStorage } from './storage.js';
import { buscarRecibos, corregirPago, leerFolio, moverPago } from './correcciones.js';

/**
 * Corregir, mover y buscar recibos desde el punto de venta (reunión del 5-oct-2026:
 * ya enlazados, el BI no edita; las correcciones se hacen aquí).
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-correcciones-' + randomUUID()));
let app: FastifyInstance;
let admin: Actor;
let cookie: Record<string, string>;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'admin1234' } });
  const c = login.cookies[0]!;
  cookie = { [c.name]: c.value };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await app.close();
});

let semana = 0;
const sabado = () => new Date(Date.UTC(2057, 0, 3 + 7 * semana++)).toISOString().slice(0, 10);

async function evento() {
  const q = await createQuote(
    prisma,
    { fecha: sabado(), invitados: 200, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Correcciones', telefono: '5515151515' } },
    admin,
  );
  quotes.push(q.id);
  await prisma.quote.update({ where: { id: q.id }, data: { status: 'formalizada' } });
  return q;
}

const pagar = async (quoteId: string, monto: number, extra: Record<string, unknown> = {}) =>
  (await registerPayment(prisma, storage, quoteId, { monto, metodo: 'transferencia', fecha: '2026-10-06', ...extra }, admin)).payment;

describe('leerFolio', () => {
  it('entiende el folio como lo teclean', () => {
    expect(leerFolio('I 4201')).toEqual({ folio: 4201, letra: null });
    expect(leerFolio('i4201')).toEqual({ folio: 4201, letra: null });
    expect(leerFolio(' 5340-b ')).toEqual({ folio: 5340, letra: 'B' });
    expect(leerFolio('5340B')).toEqual({ folio: 5340, letra: 'B' });
    expect(leerFolio('cupula')).toBeNull();
  });
});

describe('buscar un recibo por folio', () => {
  it('encuentra el pago con su evento, también por HTTP', async () => {
    const q = await evento();
    const p = await pagar(q.id, 10_000);
    const r = await buscarRecibos(prisma, `I ${p.folio}`, admin);
    expect(r.resultados).toEqual([expect.objectContaining({ tipo: 'pago', id: p.id, monto: 10_000, evento: expect.objectContaining({ id: q.id, codigo: q.etiqueta }) })]);
    const http = await app.inject({ method: 'GET', url: `/api/recibos?folio=${encodeURIComponent(`I ${p.folio}`)}`, cookies: cookie });
    expect(http.statusCode).toBe(200);
    expect(http.json().resultados[0].id).toBe(p.id);
    const malo = await app.inject({ method: 'GET', url: '/api/recibos?folio=hola', cookies: cookie });
    expect(malo.statusCode).toBe(400);
  });
});

describe('corregir un recibo', () => {
  it('cambia monto y lo divide; queda en la bitácora con antes, después y motivo', async () => {
    const q = await evento();
    const p = await pagar(q.id, 10_000);
    await corregirPago(prisma, q.id, p.id, {
      monto: 12_000,
      formas: [
        { forma: 'transferencia', monto: 7_000, nota: 'BBVA aut 123' },
        { forma: 'transferencia', monto: 5_000, nota: 'Banorte aut 456' },
      ],
      motivo: 'Eran dos transferencias',
    }, admin);
    const despues = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(despues).toMatchObject({ monto: 12_000, folio: p.folio, metodo: 'mixto' });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { quoteId: q.id, tipo: 'edicion' }, orderBy: { createdAt: 'desc' } });
    expect(log.meta).toMatchObject({ paymentId: p.id, correccion: true, motivo: 'Eran dos transferencias', antes: { monto: 10_000 }, despues: { monto: 12_000 } });
  });

  it('un pago dividido no cambia de monto sin decir cómo quedan las partes', async () => {
    const q = await evento();
    const p = await pagar(q.id, 10_000, { formas: [{ forma: 'efectivo', monto: 4_000 }, { forma: 'transferencia', monto: 6_000 }] });
    await expect(corregirPago(prisma, q.id, p.id, { monto: 11_000, motivo: 'error de dedo' }, admin)).rejects.toMatchObject({ status: 400 });
  });

  it('solo admin, y no un pago anulado ni facturado', async () => {
    const q = await evento();
    const p = await pagar(q.id, 10_000);
    await expect(corregirPago(prisma, q.id, p.id, { fecha: '2026-10-01', motivo: 'fecha mal' }, { ...admin, role: 'ventas' })).rejects.toMatchObject({ status: 403 });
    await expect(corregirPago(prisma, q.id, p.id, { motivo: 'nada' }, admin)).rejects.toThrow();
    await prisma.payment.update({ where: { id: p.id }, data: { facturadoAt: new Date() } });
    await expect(corregirPago(prisma, q.id, p.id, { fecha: '2026-10-01', motivo: 'fecha mal' }, admin)).rejects.toMatchObject({ status: 409 });
    const otro = await pagar(q.id, 5_000);
    await anularPayment(prisma, q.id, otro.id, 'prueba', admin);
    await expect(corregirPago(prisma, q.id, otro.id, { fecha: '2026-10-01', motivo: 'fecha mal' }, admin)).rejects.toMatchObject({ status: 409 });
  });

  it('si el monto corregido cubre el total, el evento se liquida', async () => {
    const q = await evento();
    const p = await pagar(q.id, 10_000);
    await corregirPago(prisma, q.id, p.id, { monto: q.total, motivo: 'era el pago completo' }, admin);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('liquidada');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).concepto).toBe('finiquito');
  });
});

describe('mover un recibo a otro evento', () => {
  it('pasa al evento por su código, con el mismo folio, y deja rastro en los dos', async () => {
    const a = await evento();
    const b = await evento();
    const p = await pagar(a.id, 10_000);
    const r = await moverPago(prisma, a.id, p.id, { destino: b.etiqueta!.toLowerCase(), motivo: 'Se capturó en el evento equivocado' }, admin);
    expect(r.destino.id).toBe(b.id);
    const movido = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(movido).toMatchObject({ quoteId: b.id, folio: p.folio, monto: 10_000, concepto: 'anticipo' });
    const enA = await prisma.activityLog.findFirstOrThrow({ where: { quoteId: a.id, tipo: 'edicion' }, orderBy: { createdAt: 'desc' } });
    expect(enA.meta).toMatchObject({ paymentId: p.id, movidoA: b.id });
    const enB = await prisma.activityLog.findFirstOrThrow({ where: { quoteId: b.id, tipo: 'pago' }, orderBy: { createdAt: 'desc' } });
    expect(enB.meta).toMatchObject({ paymentId: p.id, movidoDe: a.id });
  });

  it('un evento liquidado que pierde el pago regresa al estatus que digan sus pagos', async () => {
    const a = await evento();
    const b = await evento();
    const p = await pagar(a.id, a.total);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('liquidada');
    await moverPago(prisma, a.id, p.id, { destino: b.id, motivo: 'Era del otro evento' }, admin);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: a.id } })).status).not.toBe('liquidada');
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('liquidada');
  });

  it('rechaza el mismo evento, un código que no existe y un evento cancelado; por HTTP también', async () => {
    const a = await evento();
    const b = await evento();
    const p = await pagar(a.id, 10_000);
    await expect(moverPago(prisma, a.id, p.id, { destino: a.etiqueta, motivo: 'mismo' }, admin)).rejects.toMatchObject({ status: 400 });
    await expect(moverPago(prisma, a.id, p.id, { destino: 'NO-EXISTE-XYZ', motivo: 'nada' }, admin)).rejects.toMatchObject({ status: 404 });
    await prisma.quote.update({ where: { id: b.id }, data: { status: 'cancelada' } });
    await expect(moverPago(prisma, a.id, p.id, { destino: b.etiqueta, motivo: 'cancelado' }, admin)).rejects.toMatchObject({ status: 409 });
    const ev = await app.inject({ method: 'GET', url: `/api/eventos/por-codigo?codigo=${encodeURIComponent(a.etiqueta!)}`, cookies: cookie });
    expect(ev.json().evento).toMatchObject({ id: a.id, codigo: a.etiqueta });
    const http = await app.inject({ method: 'POST', url: `/api/quotes/${a.id}/payments/${p.id}/mover`, cookies: cookie, payload: { destino: 'NO-EXISTE-XYZ', motivo: 'nada' } });
    expect(http.statusCode).toBe(404);
  });
});
