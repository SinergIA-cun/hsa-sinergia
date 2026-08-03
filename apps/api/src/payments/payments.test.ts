import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, getByToken, loadEstadoCuenta, reconcileStatuses, type Actor } from '../quotes/service.js';
import { registerPayment, anularPayment, loadComprobanteInterno, loadComprobantePublico } from './service.js';
import { ServerStorage } from './storage.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const storage = new ServerStorage(join(tmpdir(), 'hsa-pay-test-' + randomUUID()));

let actor: Actor;
let arcosId: string, eventTypeId: string;
let app: FastifyInstance;
const quotes: string[] = [];
const clients: string[] = [];

beforeAll(async () => {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } }))!.id;
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
  app = await buildServer({ config: loadConfig() });
  await app.ready();
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await app.close();
});

async function nuevaQuote() {
  const q = await createQuote(prisma, { fecha: '2027-05-08', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Pago Test' } }, actor);
  quotes.push(q.id); clients.push(q.clientId);
  return q;
}

async function adminAuthCookie() {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
  });
  const cookie = login.cookies[0]!;
  return { [cookie.name]: cookie.value };
}

describe('registerPayment / anularPayment', () => {
  it('registra un pago y recalcula estado de cuenta', async () => {
    const q = await nuevaQuote();
    const res = await registerPayment(prisma, storage, q.id, {
      monto: 20000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2027-01-10',
    }, actor);
    expect(res.estadoCuenta.pagado).toBe(20000);
    expect(res.nuevoEstatus).toBe('formalizada'); // Arcos anticipo 20000 → auto-formalizada
    const q2 = await prisma.quote.findUnique({ where: { id: q.id } });
    expect(q2?.status).toBe('formalizada');
  });

  it('reconcileStatuses pone al día una cotización que pagó y se quedó en borrador', async () => {
    // Simula el caso real: pagó cuando aún no existían las reglas de pago, así
    // que el auto-avance nunca disparó y el estatus se quedó atrás.
    const q = await nuevaQuote();
    await registerPayment(prisma, storage, q.id, {
      monto: 125000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2027-01-10',
    }, actor);
    // Forzamos el estatus atrasado a mano (como quedó en producción).
    await prisma.quote.update({ where: { id: q.id }, data: { status: 'borrador' } });

    const cambios = await reconcileStatuses(prisma);
    const mio = cambios.find((c) => c.quoteId === q.id);
    expect(mio).toBeDefined();
    expect(mio!.de).toBe('borrador');
    // Arcos 250 pax sábado: renta 108,500. Pagó 125,000 ⇒ cubre el finiquito.
    expect(mio!.a).toBe('liquidada');

    const actualizada = await prisma.quote.findUnique({ where: { id: q.id } });
    expect(actualizada?.status).toBe('liquidada');

    // Idempotente: una segunda pasada ya no cambia nada.
    const segunda = await reconcileStatuses(prisma);
    expect(segunda.find((c) => c.quoteId === q.id)).toBeUndefined();
  });

  it('anular excluye el pago del acumulado (solo admin)', async () => {
    const q = await nuevaQuote();
    const { payment } = await registerPayment(prisma, storage, q.id, {
      monto: 20000, metodo: 'efectivo', concepto: 'anticipo', fecha: '2027-01-10',
    }, actor);
    const after = await anularPayment(prisma, q.id, payment.id, 'monto equivocado', actor);
    expect(after.estadoCuenta.pagado).toBe(0);
  });

  it('ventas no puede anular', async () => {
    const q = await nuevaQuote();
    const { payment } = await registerPayment(prisma, storage, q.id, {
      monto: 5000, metodo: 'efectivo', concepto: 'aCuenta', fecha: '2027-01-10',
    }, actor);
    await expect(
      anularPayment(prisma, q.id, payment.id, 'x', { id: actor.id, role: 'ventas' }),
    ).rejects.toThrow();
  });

  it('rechaza registrar pago si la cotización no pertenece a ventas (404 antes de crear el pago)', async () => {
    const q = await nuevaQuote();
    await expect(
      registerPayment(prisma, storage, q.id, {
        monto: 5000, metodo: 'efectivo', concepto: 'aCuenta', fecha: '2027-01-10',
      }, { id: 'no-existe-ventas', role: 'ventas' }),
    ).rejects.toThrow();

    const count = await prisma.payment.count({ where: { quoteId: q.id } });
    expect(count).toBe(0);
  });

  it('rechaza anular un pago que no pertenece a la cotización indicada (404) y no lo anula', async () => {
    const q1 = await nuevaQuote();
    const q2 = await nuevaQuote();
    const { payment } = await registerPayment(prisma, storage, q1.id, {
      monto: 5000, metodo: 'efectivo', concepto: 'aCuenta', fecha: '2027-01-10',
    }, actor);

    await expect(anularPayment(prisma, q2.id, payment.id, 'motivo', actor)).rejects.toThrow();

    const { estadoCuenta } = await loadEstadoCuenta(prisma, q1);
    expect(estadoCuenta.pagado).toBe(5000);
  });
});

describe('getByToken (vista pública)', () => {
  it('expone solo campos públicos en pagos y excluye los anulados', async () => {
    const q = await nuevaQuote();
    const { payment: p1 } = await registerPayment(prisma, storage, q.id, {
      monto: 20000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2027-01-10', referencia: 'ref-123',
    }, actor);
    await registerPayment(prisma, storage, q.id, {
      monto: 5000, metodo: 'efectivo', concepto: 'aCuenta', fecha: '2027-01-15',
    }, actor);
    await anularPayment(prisma, q.id, p1.id, 'anulado de prueba', actor);

    const result = await getByToken(prisma, q.publicToken);
    expect(result?.estadoCuenta.pagado).toBe(5000);
    expect(result?.estadoCuenta.pagos).toHaveLength(1);

    const pago = result!.estadoCuenta.pagos[0]! as Record<string, unknown>;
    expect(Object.keys(pago).sort()).toEqual(['concepto', 'fecha', 'folio', 'id', 'metodo', 'monto', 'tieneComprobante']);
    expect('referencia' in pago).toBe(false);
    expect('comprobanteKey' in pago).toBe(false);
    expect('registradoById' in pago).toBe(false);
  });
});

describe('comprobante (foto de pago)', () => {
  it('guarda la foto al registrar y la sirve por proxy interno y público', async () => {
    const q = await nuevaQuote();
    const png = Buffer.from('fake-image-bytes');
    const { payment } = await registerPayment(
      prisma, storage, q.id,
      { monto: 20000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2027-01-10' },
      actor,
      { data: png, mime: 'image/png' },
    );
    expect(payment.comprobanteKey).toBeTruthy();
    expect(payment.comprobanteMime).toBe('image/png');

    const interno = await loadComprobanteInterno(prisma, storage, q.id, payment.id, actor);
    expect(interno?.data.toString()).toBe('fake-image-bytes');
    expect(interno?.mime).toBe('image/png');

    const publico = await loadComprobantePublico(prisma, storage, q.publicToken, payment.id);
    expect(publico?.data.toString()).toBe('fake-image-bytes');

    // Un pago sin foto no devuelve comprobante.
    const { payment: sinFoto } = await registerPayment(
      prisma, storage, q.id,
      { monto: 1000, metodo: 'efectivo', concepto: 'aCuenta', fecha: '2027-01-11' },
      actor,
    );
    expect(await loadComprobanteInterno(prisma, storage, q.id, sinFoto.id, actor)).toBeNull();
  });
});

describe('validación HTTP de pagos', () => {
  it('POST /quotes/:id/payments con monto negativo devuelve 400', async () => {
    const q = await nuevaQuote();
    const auth = await adminAuthCookie();

    const post = await app.inject({
      method: 'POST',
      url: `/api/quotes/${q.id}/payments`,
      cookies: auth,
      payload: { monto: -5, metodo: 'efectivo', concepto: 'aCuenta', fecha: '2027-01-10' },
    });
    expect(post.statusCode).toBe(400);
  });

  it('PATCH .../anular sin motivo devuelve 400', async () => {
    const q = await nuevaQuote();
    const auth = await adminAuthCookie();

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/quotes/${q.id}/payments/no-existe-payment-id/anular`,
      cookies: auth,
      payload: {},
    });
    expect(patch.statusCode).toBe(400);
  });
});

describe('pagos HTTP', () => {
  it('POST pago => 201; GET quote refleja pagado; PATCH anular => vuelve a 0', async () => {
    const q = await nuevaQuote();

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
    });
    const cookie = login.cookies[0]!;
    const auth = { [cookie.name]: cookie.value };

    const post = await app.inject({
      method: 'POST',
      url: `/api/quotes/${q.id}/payments`,
      cookies: auth,
      payload: { monto: 20000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2027-01-10' },
    });
    expect(post.statusCode).toBe(201);
    const paymentId = post.json().payment.id as string;

    const get = await app.inject({ method: 'GET', url: `/api/quotes/${q.id}`, cookies: auth });
    expect(get.statusCode).toBe(200);
    expect(get.json().estadoCuenta.pagado).toBe(20000);

    const anular = await app.inject({
      method: 'PATCH',
      url: `/api/quotes/${q.id}/payments/${paymentId}/anular`,
      cookies: auth,
      payload: { motivo: 'error de captura' },
    });
    expect(anular.statusCode).toBe(200);
    expect(anular.json().estadoCuenta.pagado).toBe(0);
  });
});
