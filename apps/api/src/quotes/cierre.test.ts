import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, type Actor } from './service.js';
import { registerPayment } from '../payments/service.js';
import { ServerStorage } from '../payments/storage.js';
import { moverPago } from '../payments/correcciones.js';

/** "Cerrar evento" (reunión del 15-oct-2026). */

const storage = new ServerStorage(join(tmpdir(), 'hsa-cierre-' + randomUUID()));
let app: FastifyInstance;
let admin: Actor;
let cookie: Record<string, string>;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];
let semana = 0;
const sabado = () => new Date(Date.UTC(2064, 0, 5 + 7 * semana++)).toISOString().slice(0, 10);

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
  await prisma.correoCliente.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await app.close();
});

async function evento() {
  const q = await createQuote(
    prisma,
    { fecha: sabado(), invitados: 200, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Cierre Test', telefono: '5517171717', correo: 'c@example.com' } },
    admin,
  );
  quotes.push(q.id);
  return q;
}
const http = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: cookie, ...(payload ? { payload } : {}) });

describe('cerrar evento', () => {
  it('solo se cierra uno formalizado; cerrado no acepta pagos, cambios ni estatus; facturar y reabrir sí', async () => {
    const q = await evento();
    expect((await http('POST', `/api/quotes/${q.id}/cerrar`)).statusCode).toBe(409); // borrador
    const { payment } = await registerPayment(prisma, storage, q.id, { monto: q.total, metodo: 'transferencia', fecha: '2026-10-01' }, admin);

    const cerrar = await http('POST', `/api/quotes/${q.id}/cerrar`, { nota: 'Conciliado' });
    expect(cerrar.statusCode).toBe(200);

    const pago = await http('POST', `/api/quotes/${q.id}/payments`, { monto: 100, metodo: 'efectivo', fecha: '2026-10-02' });
    expect(pago.statusCode).toBe(409);
    expect(pago.json().error).toMatch(/cerrado/);
    expect((await http('PATCH', `/api/quotes/${q.id}/status`, { status: 'formalizada' })).statusCode).toBe(409);
    expect((await http('PATCH', `/api/quotes/${q.id}/payments/${payment.id}/anular`, { motivo: 'no' })).statusCode).toBe(409);
    expect((await http('POST', `/api/quotes/${q.id}/standby`, { motivo: 'x' })).statusCode).toBe(409);

    // Facturar sí: eso pasa después del cierre de mes.
    const fact = await http('PATCH', `/api/quotes/${q.id}/payments/${payment.id}/facturado`, {});
    expect(fact.statusCode).not.toBe(409);

    expect((await http('POST', `/api/quotes/${q.id}/reabrir`, { motivo: 'x' })).statusCode).toBe(400);
    expect((await http('POST', `/api/quotes/${q.id}/reabrir`, { motivo: 'Faltó un cargo' })).statusCode).toBe(200);
    expect((await http('POST', `/api/quotes/${q.id}/payments`, { monto: 100, metodo: 'efectivo', fecha: '2026-10-02' })).statusCode).toBe(201);

    const logs = await prisma.activityLog.findMany({ where: { quoteId: q.id, tipo: 'estatus' }, select: { descripcion: true } });
    expect(logs.map((l) => l.descripcion).join(' | ')).toMatch(/cerrado.*Conciliado|Conciliado/);
    expect(logs.some((l) => /reabierto.*Faltó un cargo/i.test(l.descripcion))).toBe(true);
  });

  it('un vendedor no cierra; no se le mueve un pago a un evento cerrado', async () => {
    const a = await evento();
    const b = await evento();
    await prisma.quote.update({ where: { id: b.id }, data: { status: 'formalizada', cerradoAt: new Date(), cerradoById: admin.id } });
    const { payment } = await registerPayment(prisma, storage, a.id, { monto: 1_000, metodo: 'transferencia', fecha: '2026-10-01' }, admin);
    await expect(moverPago(prisma, a.id, payment.id, { destino: b.id, motivo: 'era del otro' }, admin)).rejects.toMatchObject({ status: 409 });
    const { cerrarEvento } = await import('./cierre.js');
    await expect(cerrarEvento(prisma, a.id, {}, { id: admin.id, role: 'ventas' })).rejects.toMatchObject({ status: 403 });
  });
});
