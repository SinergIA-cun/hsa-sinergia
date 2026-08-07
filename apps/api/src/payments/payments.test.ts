import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, getByToken, getQuote, loadEstadoCuenta, reconcileStatuses, softDeleteQuote, updateQuote, type Actor } from '../quotes/service.js';
import { registerPayment, anularPayment, desbloquearFactura, loadComprobanteInterno, loadComprobantePublico } from './service.js';
import { ServerStorage } from './storage.js';
import { hashPassword } from '../auth/password.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const storage = new ServerStorage(join(tmpdir(), 'hsa-pay-test-' + randomUUID()));

let actor: Actor;
let arcosId: string, eventTypeId: string;
let app: FastifyInstance;
let ventasId: string;
const ventasEmail = `ventas-pay-${randomUUID()}@haciendasanandres.com.mx`;
const quotes: string[] = [];
const clients: string[] = [];

beforeAll(async () => {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } }))!.id;
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
  const ventas = await prisma.user.create({
    data: {
      nombre: 'Vendedora de prueba',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventasId = ventas.id;
  app = await buildServer({ config: loadConfig() });
  await app.ready();
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.user.delete({ where: { id: ventasId } });
  await app.close();
});

// Cada cotización necesita SU PROPIA fecha: registrar un pago la formaliza, y el
// servidor ya rechaza cotizar sobre un espacio comprometido. Se avanza de 7 en 7
// días desde un sábado para que todas caigan en sábado — el precio depende del
// tipo de día, así que el desglose es idéntico en todas.
const PRIMER_SABADO = '2030-06-01';
let sabadoSeq = 0;

function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

async function nuevaQuote() {
  const q = await createQuote(prisma, { fecha: siguienteSabado(), invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Pago Test' } }, actor);
  quotes.push(q.id); clients.push(q.clientId);
  return q;
}

/** Payload base de `updateQuote` reconstruido desde una cotización recién creada. */
function selectionDe(q: { fechaEvento: Date; invitados: number; spaceIds: string[]; eventTypeId: string; horasExtra: number }) {
  return {
    fecha: q.fechaEvento.toISOString().slice(0, 10),
    invitados: q.invitados,
    spaceIds: q.spaceIds,
    eventTypeId: q.eventTypeId,
    horasExtra: q.horasExtra,
  };
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

/** Cookie de una vendedora real: `requireAdmin` solo se puede probar con un rol distinto. */
async function ventasAuthCookie() {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: ventasEmail, password: 'ventas1234' },
  });
  const cookie = login.cookies[0]!;
  return { [cookie.name]: cookie.value };
}

/** Cotización nueva con un pago vigente, lista para sellarse como facturada. */
async function crearPagoDePrueba() {
  const q = await nuevaQuote();
  const { payment } = await registerPayment(prisma, storage, q.id,
    { monto: 20000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2027-01-10' }, actor);
  return { quoteId: q.id, paymentId: payment.id, quote: q };
}

async function crearPagoAnulado() {
  const { quoteId, paymentId } = await crearPagoDePrueba();
  await anularPayment(prisma, quoteId, paymentId, 'error de captura', actor);
  return { quoteId, paymentId };
}

async function marcarFacturadoComoAdmin(quoteId: string, paymentId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`,
    cookies: await adminAuthCookie(),
    payload: {},
  });
  expect(res.statusCode).toBe(200);
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

describe('candado de facturación', () => {
  it('un pago del mes en curso viene marcado como facturable', async () => {
    const q = await nuevaQuote();
    await registerPayment(prisma, storage, q.id,
      { monto: 15000, metodo: 'transferencia', concepto: 'anticipo', fecha: new Date().toISOString().slice(0, 10) },
      actor);
    const { payments } = await loadEstadoCuenta(prisma, {
      id: q.id, breakdown: q.breakdown, rentaTotal: q.rentaTotal,
      fechaEvento: q.fechaEvento, status: q.status, spaceIds: q.spaceIds,
    });
    expect(payments[0]).toBeDefined();
    const detalle = (await getQuote(prisma, q.id, actor))!;
    expect(detalle.payments[0]!.facturable).toBe(true);
    expect(detalle.payments[0]!.motivoFactura).toBeNull();
  });

  it('un pago de un mes cerrado ya no es facturable', async () => {
    const q = await nuevaQuote();
    const p = await registerPayment(prisma, storage, q.id,
      { monto: 15000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2020-03-15' },
      actor);
    expect(p.payment).toBeDefined();
    const detalle = (await getQuote(prisma, q.id, actor))!;
    const pago = detalle.payments.find((x) => x.id === p.payment.id)!;
    expect(pago.facturable).toBe(false);
    expect(pago.motivoFactura).toMatch(/público en general/i);
  });

  it('un mes cerrado marca el pago como no facturable pero NO congela los datos fiscales', async () => {
    // El pago se fue a la factura global de público en general: nunca llevó los
    // datos del cliente a un CFDI, así que no hay nada que proteger. El candado
    // de los datos fiscales lo cierra la primera factura emitida, no el mes.
    const q = await nuevaQuote();
    await registerPayment(prisma, storage, q.id,
      { monto: 15000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2020-03-15' },
      actor);
    const detalle = (await getQuote(prisma, q.id, actor))!;
    expect(detalle.payments[0]!.facturable).toBe(false);
    expect(detalle.fiscalEditable.editable).toBe(true);
    expect(detalle.fiscalEditable.motivo).toBeNull();
  });

  it('una cotización sin pagos deja capturar datos fiscales con normalidad', async () => {
    const q = await nuevaQuote();
    const detalle = (await getQuote(prisma, q.id, actor))!;
    expect(detalle.payments).toHaveLength(0);
    expect(detalle.fiscalEditable.editable).toBe(true);

    const actualizada = await updateQuote(prisma, q.id, {
      ...selectionDe(q),
      client: { nombre: 'Pago Test', rfc: 'XAXX010101000', razonSocial: 'Cliente Nuevo' },
    }, actor);
    expect(actualizada.client.rfc).toBe('XAXX010101000');
  });

  it('con el mes cerrado y sin factura emitida, el RFC todavía se puede corregir', async () => {
    const q = await nuevaQuote();
    await registerPayment(prisma, storage, q.id,
      { monto: 15000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2020-03-15' },
      actor);

    // El formulario manda SIEMPRE los seis campos fiscales: reenviarlos sin
    // cambio no debe impedir editar el resto del evento.
    const sinCambioFiscal = await updateQuote(prisma, q.id, {
      ...selectionDe(q),
      invitados: 260,
      client: { nombre: 'Pago Test', rfc: null, razonSocial: null, regimenFiscal: null, cpFiscal: null, usoCfdi: null, correoFacturacion: null },
    }, actor);
    expect(sinCambioFiscal.invitados).toBe(260);

    const conRfc = await updateQuote(prisma, q.id, {
      ...selectionDe(q),
      invitados: 260,
      client: { nombre: 'Pago Test', rfc: 'XAXX010101000' },
    }, actor);
    expect(conRfc.client.rfc).toBe('XAXX010101000');
  });

  it('no se desbloquea un pago de una cotización en la papelera', async () => {
    // La papelera es evidencia de auditoría: solo lectura, también para el
    // desbloqueo. Que el botón no se pinte en la UI no basta.
    const q = await nuevaQuote();
    const p = await registerPayment(prisma, storage, q.id,
      { monto: 15000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2020-03-15' },
      actor);
    await anularPayment(prisma, q.id, p.payment.id, 'error de captura', actor);
    await softDeleteQuote(prisma, q.id, actor);

    await expect(desbloquearFactura(prisma, q.id, p.payment.id, actor)).rejects.toThrow(/papelera/i);

    const sinTocar = await prisma.payment.findUnique({ where: { id: p.payment.id } });
    expect(sinTocar?.desbloqueoAt).toBeNull();
  });

  it('solo un admin puede desbloquear la facturación de un pago', async () => {
    const q = await nuevaQuote();
    const p = await registerPayment(prisma, storage, q.id,
      { monto: 15000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2020-03-15' },
      actor);
    const ventas = { id: actor.id, role: 'ventas' as const };
    await expect(desbloquearFactura(prisma, q.id, p.payment.id, ventas)).rejects.toThrow(/admin/i);

    const ok = await desbloquearFactura(prisma, q.id, p.payment.id, actor);
    expect(ok.facturable).toBe(true);
    const log = await prisma.activityLog.findFirst({
      where: { quoteId: q.id, descripcion: { contains: 'Desbloqueo' } },
    });
    expect(log).not.toBeNull();

    // Y el candado reabierto se ve en el detalle.
    const detalle = (await getQuote(prisma, q.id, actor))!;
    expect(detalle.payments.find((x) => x.id === p.payment.id)!.facturable).toBe(true);
    expect(detalle.fiscalEditable.editable).toBe(true);
  });
});

describe('marcar facturado', () => {
  it('un admin sella el pago y queda en la bitácora', async () => {
    const { quoteId, paymentId } = await crearPagoDePrueba();
    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`,
      cookies: await adminAuthCookie(),
      payload: { facturaUuid: '11111111-2222-3333-4444-555555555555' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().facturadoAt).not.toBeNull();
    expect(res.json().facturaUuid).toBe('11111111-2222-3333-4444-555555555555');

    const logs = await prisma.activityLog.findMany({ where: { quoteId, tipo: 'factura' } });
    expect(logs).toHaveLength(1);
  });

  it('sellar un pago congela los datos fiscales del cliente', async () => {
    const { quoteId, paymentId } = await crearPagoDePrueba();
    const antes = (await getQuote(prisma, quoteId, actor))!;
    expect(antes.fiscalEditable.editable).toBe(true);

    await app.inject({
      method: 'POST',
      url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`,
      cookies: await adminAuthCookie(),
      payload: {},
    });

    const despues = (await getQuote(prisma, quoteId, actor))!;
    expect(despues.fiscalEditable.editable).toBe(false);
    expect(despues.fiscalEditable.motivo).toMatch(/factura/i);
  });

  it('un vendedor no puede', async () => {
    const { quoteId, paymentId } = await crearPagoDePrueba();
    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`,
      cookies: await ventasAuthCookie(),
      payload: {},
    });
    expect(res.statusCode).toBe(403);

    const sinTocar = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(sinTocar?.facturadoAt).toBeNull();
  });

  it('no se puede facturar dos veces', async () => {
    const { quoteId, paymentId } = await crearPagoDePrueba();
    const cookies = await adminAuthCookie();
    const url = `/api/quotes/${quoteId}/payments/${paymentId}/facturado`;
    expect((await app.inject({ method: 'POST', url, cookies, payload: {} })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url, cookies, payload: {} });
    expect(res.statusCode).toBe(409);
  });

  it('un pago anulado no se puede facturar', async () => {
    const { quoteId, paymentId } = await crearPagoAnulado();
    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`,
      cookies: await adminAuthCookie(),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it('un UUID mal formado devuelve 400 y no sella nada', async () => {
    const { quoteId, paymentId } = await crearPagoDePrueba();
    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`,
      cookies: await adminAuthCookie(),
      payload: { facturaUuid: 'no-es-un-uuid' },
    });
    expect(res.statusCode).toBe(400);
    const sinTocar = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(sinTocar?.facturadoAt).toBeNull();
  });
});

describe('datos fiscales con una factura emitida', () => {
  /** Los seis campos que el formulario manda SIEMPRE, aunque no se toque ninguno. */
  const fiscalesSinCambio = {
    rfc: null, razonSocial: null, regimenFiscal: null,
    cpFiscal: null, usoCfdi: null, correoFacturacion: null,
  };

  it('un vendedor no puede cambiar el RFC después de facturar', async () => {
    const { quoteId, paymentId, quote } = await crearPagoDePrueba();
    await marcarFacturadoComoAdmin(quoteId, paymentId);

    const ventas = { id: actor.id, role: 'ventas' as const };
    await expect(
      updateQuote(prisma, quoteId, {
        ...selectionDe(quote),
        client: { nombre: 'Pago Test', rfc: 'XAXX010101000' },
      }, ventas),
    ).rejects.toThrow(/factura/i);

    const cliente = await prisma.client.findUnique({ where: { id: quote.clientId } });
    expect(cliente?.rfc).toBeNull();
  });

  it('un admin sí puede, y queda en la bitácora', async () => {
    const { quoteId, paymentId, quote } = await crearPagoDePrueba();
    await marcarFacturadoComoAdmin(quoteId, paymentId);

    const actualizada = await updateQuote(prisma, quoteId, {
      ...selectionDe(quote),
      client: { nombre: 'Pago Test', rfc: 'XAXX010101000' },
    }, actor);
    expect(actualizada.client.rfc).toBe('XAXX010101000');

    const logs = await prisma.activityLog.findMany({ where: { quoteId, tipo: 'fiscal' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.descripcion).toMatch(/desbloqueo de admin/i);
  });

  it('editar solo los invitados sigue funcionando con datos congelados', async () => {
    // La guardia compara VALORES, no presencia de llave: el formulario reenvía
    // los seis campos fiscales en cada guardado. Si comparara presencia, esto
    // sería un 409 y la vendedora no podría tocar nada más del evento.
    const { quoteId, paymentId, quote } = await crearPagoDePrueba();
    await marcarFacturadoComoAdmin(quoteId, paymentId);

    const ventas = { id: actor.id, role: 'ventas' as const };
    const actualizada = await updateQuote(prisma, quoteId, {
      ...selectionDe(quote),
      invitados: 180,
      client: { nombre: 'Pago Test', ...fiscalesSinCambio },
    }, ventas);
    expect(actualizada.invitados).toBe(180);
  });

  it('omitir un campo fiscal no cuenta como borrarlo', async () => {
    // `rfc` ausente significa "déjalo como está", no "ponlo en null". Sin esta
    // distinción, guardar el formulario reducido dispararía un 409 fantasma.
    const { quoteId, paymentId, quote } = await crearPagoDePrueba();
    await updateQuote(prisma, quoteId, {
      ...selectionDe(quote),
      client: { nombre: 'Pago Test', rfc: 'XAXX010101000' },
    }, actor);
    await marcarFacturadoComoAdmin(quoteId, paymentId);

    const ventas = { id: actor.id, role: 'ventas' as const };
    const actualizada = await updateQuote(prisma, quoteId, {
      ...selectionDe(quote),
      invitados: 190,
      client: { nombre: 'Pago Test' },
    }, ventas);
    expect(actualizada.invitados).toBe(190);
    expect(actualizada.client.rfc).toBe('XAXX010101000');
  });

  it('sin factura emitida no se escribe bitácora fiscal de desbloqueo', async () => {
    const { quoteId, quote } = await crearPagoDePrueba();
    await updateQuote(prisma, quoteId, {
      ...selectionDe(quote),
      client: { nombre: 'Pago Test', rfc: 'XAXX010101000' },
    }, actor);

    const logs = await prisma.activityLog.findMany({ where: { quoteId, tipo: 'fiscal' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.descripcion).not.toMatch(/desbloqueo/i);
  });
});
