import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma, type Prisma } from '@hsa/database';
import { desgloseImportado } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, type Actor } from './service.js';
import { registerPayment } from '../payments/service.js';
import { ServerStorage } from '../payments/storage.js';

/** Ajustar el precio de un evento importado del BI (13-oct-2026: "el valor del contrato subió"). */

const storage = new ServerStorage(join(tmpdir(), 'hsa-precio-pactado-' + randomUUID()));
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
const sabado = () => new Date(Date.UTC(2058, 0, 5 + 7 * semana++)).toISOString().slice(0, 10);

/** Un evento como los que manda el BI: renta y alimentos pactados. */
async function importado(renta: number, otros: number, pactado = true) {
  const q = await createQuote(
    prisma,
    { fecha: sabado(), invitados: 200, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Precio pactado', telefono: '5516161616', correo: 'p@example.com' } },
    admin,
  );
  quotes.push(q.id);
  if (pactado) {
    const b = desgloseImportado({ salones: [{ spaceId: arcosId, nombre: 'Arcos' }], rentaTotal: renta, otrosTotal: otros, ivaRate: 0.16 });
    await prisma.quote.update({
      where: { id: q.id },
      data: { breakdown: b as unknown as Prisma.InputJsonValue, total: renta + otros, rentaTotal: renta, precioPactado: true, status: 'formalizada' },
    });
  }
  return q;
}

const ajustar = (id: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/api/quotes/${id}/precio-pactado`, cookies: cookie, payload });

describe('ajustar el precio pactado', () => {
  it('sube la renta y los alimentos, deja bitácora y un evento liquidado vuelve a tener saldo', async () => {
    const q = await importado(40_000, 10_000);
    await registerPayment(prisma, storage, q.id, { monto: 40_000, metodo: 'transferencia', fecha: '2026-10-06' }, admin);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('liquidada');

    const r = await ajustar(q.id, { renta: 45_000, otros: 12_913, motivo: 'Subieron invitados en el BI' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ total: 57_913, rentaTotal: 45_000, otrosTotal: 12_913 });

    const despues = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(despues.total).toBe(57_913);
    expect(despues.rentaTotal).toBe(45_000);
    expect(despues.status).not.toBe('liquidada');
    const log = await prisma.activityLog.findFirstOrThrow({ where: { quoteId: q.id, tipo: 'edicion' } });
    expect(log.descripcion).toContain('total $50,000 → $57,913');
    expect(log.descripcion).toContain('Motivo: Subieron invitados en el BI');
  });

  it('sin alimentos en el cuerpo solo cambia la renta', async () => {
    const q = await importado(40_000, 10_000);
    const r = await ajustar(q.id, { renta: 47_913, motivo: 'Renta corregida' });
    expect(r.json()).toEqual({ total: 57_913, rentaTotal: 47_913, otrosTotal: 10_000 });
  });

  it('no deja la renta por debajo de lo pagado, ni ajusta sin motivo o un evento del catálogo', async () => {
    const q = await importado(40_000, 0);
    await registerPayment(prisma, storage, q.id, { monto: 30_000, metodo: 'transferencia', fecha: '2026-10-06' }, admin);
    const bajo = await ajustar(q.id, { renta: 25_000, motivo: 'Descuento' });
    expect(bajo.statusCode).toBe(409);
    expect(bajo.json().error).toContain('$30,000');

    expect((await ajustar(q.id, { renta: 45_000, motivo: '' })).statusCode).toBe(400);
    expect((await ajustar(q.id, { renta: 40_000, motivo: 'igual' })).statusCode).toBe(400);

    const deCatalogo = await importado(0, 0, false);
    expect((await ajustar(deCatalogo.id, { renta: 45_000, motivo: 'no aplica' })).statusCode).toBe(409);
  });
});
