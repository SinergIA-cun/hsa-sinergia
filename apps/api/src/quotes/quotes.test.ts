import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import {
  createQuote,
  duplicateQuote,
  expireStaleQuotes,
  getByToken,
  loadEstadoCuenta,
  softDeleteQuote,
  restoreQuote,
  listTrash,
  listQuotes,
  updateQuote,
  updateStatus,
  type Actor,
} from './service.js';

let app: FastifyInstance;
let actor: Actor;
const createdQuoteIds: string[] = [];
const createdClientIds: string[] = [];

async function ids() {
  const eventType = await prisma.eventType.findFirst({ where: { slug: 'boda' } });
  const arcos = await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } });
  const campos = await prisma.space.findFirst({ where: { nombre: 'Jardín Los Campos' } });
  const cupula = await prisma.space.findFirst({ where: { nombre: 'Jardín La Cúpula' } });
  const capilla = await prisma.space.findFirst({ where: { nombre: 'La Capilla' } });
  return {
    eventTypeId: eventType!.id,
    arcosId: arcos!.id,
    camposId: campos!.id,
    cupulaId: cupula!.id,
    capillaId: capilla!.id,
  };
}

/** Cookie de sesión del admin, lista para pasarla a `app.inject({ cookies })`. */
async function authCookies() {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
  });
  const cookie = login.cookies[0]!;
  return { [cookie.name]: cookie.value };
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@haciendasanandres.com.mx' },
  });
  actor = { id: admin!.id, role: 'admin' };
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
  await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  await app.close();
});

describe('quotes service', () => {
  it('createQuote calcula total = motor (108,500) y persiste con token', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(prisma, {
      fecha: '2030-01-05', // sábado propio: el servidor bloquea el espacio comprometido
      invitados: 250,
      spaceIds: [arcosId],
      eventTypeId,
      client: { nombre: 'Cliente Test' },
    }, actor);
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    expect(q.total).toBe(108500);
    expect(q.publicToken).toHaveLength(32);
  });

  it('getByToken devuelve estado de cuenta con saldo = total', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(prisma, {
      fecha: '2027-05-09',
      invitados: 250,
      spaceIds: [arcosId],
      eventTypeId,
      client: { nombre: 'Cliente Token' },
    }, actor);
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    const result = await getByToken(prisma, q.publicToken);
    expect(result?.estadoCuenta.saldo).toBe(q.total);
    expect(result?.estadoCuenta.pagado).toBe(0);
  });

  it('listQuotes marca desfase cuando el estatus exige un pago no cubierto, y lo limpia al pagar', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2027-06-14', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Desfase Test' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    // Formalizada sin pagos: el anticipo (regla de Arcos) no está cubierto ⇒ desfase.
    await updateStatus(prisma, q.id, 'formalizada', actor);
    const conDesfase = await listQuotes(prisma, actor);
    expect(conDesfase.find((x) => x.id === q.id)?.desfase).toBe(true);

    // Registrado el anticipo, ya no hay desfase.
    await prisma.payment.create({
      data: { quoteId: q.id, monto: 20000, metodo: 'transferencia', concepto: 'anticipo', fecha: new Date('2027-01-15T00:00:00.000Z') },
    });
    const sinDesfase = await listQuotes(prisma, actor);
    expect(sinDesfase.find((x) => x.id === q.id)?.desfase).toBe(false);
  });

  it('duplicateQuote clona como borrador con token propio, reusando el mismo cliente', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2027-07-20', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Original Dup' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    await updateStatus(prisma, q.id, 'formalizada', actor); // aunque la fuente esté formalizada…

    const dup = await duplicateQuote(prisma, q.id, actor);
    createdQuoteIds.push(dup.id);
    expect(dup.id).not.toBe(q.id);
    expect(dup.clientId).toBe(q.clientId); // reusa cliente, sin duplicarlo
    expect(dup.status).toBe('borrador'); // …la copia nace en borrador
    expect(dup.total).toBe(q.total);
    expect(dup.publicToken).not.toBe(q.publicToken);
    const log = await prisma.activityLog.findMany({ where: { quoteId: dup.id } });
    expect(log.some((l) => /duplicada de/.test(l.descripcion))).toBe(true);
  });

  it('expireStaleQuotes vence pipeline pasado de vigencia, pero no toca las reservadas', async () => {
    const { eventTypeId, arcosId } = await ids();
    const pipeline = await createQuote(
      prisma,
      { fecha: '2027-08-01', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Vence Pipeline' } },
      actor,
    );
    createdQuoteIds.push(pipeline.id);
    createdClientIds.push(pipeline.clientId);
    await prisma.quote.update({ where: { id: pipeline.id }, data: { vigenciaHasta: new Date('2020-01-01T00:00:00.000Z') } });

    const reservada = await createQuote(
      prisma,
      { fecha: '2027-08-02', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'No Vence Reservada' } },
      actor,
    );
    createdQuoteIds.push(reservada.id);
    createdClientIds.push(reservada.clientId);
    await updateStatus(prisma, reservada.id, 'formalizada', actor);
    await prisma.quote.update({ where: { id: reservada.id }, data: { vigenciaHasta: new Date('2020-01-01T00:00:00.000Z') } });

    const vencidas = await expireStaleQuotes(prisma);
    expect(vencidas).toBeGreaterThanOrEqual(1);

    const p = await prisma.quote.findUnique({ where: { id: pipeline.id } });
    const r = await prisma.quote.findUnique({ where: { id: reservada.id } });
    expect(p?.status).toBe('vencida');
    expect(r?.status).toBe('formalizada'); // reserva intacta
  });

  it('el complemento tiene fecha de vencimiento después de formalizar (bitácora nueva)', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2029-06-16', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Fecha Apartado' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    await updateStatus(prisma, q.id, 'formalizada', actor);

    const { estadoCuenta } = await loadEstadoCuenta(prisma, {
      id: q.id,
      breakdown: q.breakdown,
      rentaTotal: q.rentaTotal,
      fechaEvento: q.fechaEvento,
      status: 'formalizada',
      spaceIds: q.spaceIds,
    });
    const comp = estadoCuenta.plan!.find((m) => m.key === 'complemento')!;
    expect(comp.venceISO).not.toBeNull();
  });

  it('rechaza crear sobre un espacio comprometido (bloqueo del servidor, sin pasar por el navegador)', async () => {
    const { eventTypeId, arcosId } = await ids();
    const ocupa = await createQuote(
      prisma,
      { fecha: '2029-08-11', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Ocupa Arcos' } },
      actor,
    );
    createdQuoteIds.push(ocupa.id);
    createdClientIds.push(ocupa.clientId);
    await updateStatus(prisma, ocupa.id, 'formalizada', actor);

    await expect(
      createQuote(
        prisma,
        { fecha: '2029-08-11', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Encima' } },
        actor,
      ),
    ).rejects.toThrow(/no está disponible/i);

    // El rechazo no deja basura: el guardia corre ANTES de crear el cliente.
    expect(await prisma.client.count({ where: { nombre: 'Encima' } })).toBe(0);
  });

  it('editar sin cambiar fecha ni espacio no se auto-bloquea', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2029-08-12', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Auto Bloqueo' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    await updateStatus(prisma, q.id, 'formalizada', actor);

    const editada = await updateQuote(
      prisma,
      q.id,
      { fecha: '2029-08-12', invitados: 260, spaceIds: [arcosId], eventTypeId, horasExtra: 0, addOns: [] },
      actor,
    );
    expect(editada.invitados).toBe(260);
  });

  it('acepta hasta 3 espacios y suma su renta', async () => {
    const { eventTypeId, arcosId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2029-09-15',
        invitados: 250,
        spaceIds: [arcosId, camposId],
        eventTypeId,
        client: { nombre: 'Dos Salones' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    expect(q.spaceIds).toHaveLength(2);
    const lineasRenta = (q.breakdown as { lines: { spaceId?: string }[] }).lines.filter((l) => l.spaceId);
    expect(lineasRenta).toHaveLength(2);
  });

  it('dos salones con regla: el anticipo del plan suma los dos', async () => {
    const { eventTypeId, arcosId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2029-10-06', invitados: 250, spaceIds: [arcosId, camposId], eventTypeId, client: { nombre: 'Plan Dos Salones' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const { estadoCuenta } = await loadEstadoCuenta(prisma, q);
    expect(estadoCuenta.planPendiente).toBe(false);
    // Arcos $20,000 + Campos $15,000 = $35,000 de anticipo.
    expect(estadoCuenta.plan!.find((m) => m.key === 'apartar')!.objetivo).toBe(35000);
  });

  it('si un salón del evento no tiene regla, el plan queda pendiente', async () => {
    // La Capilla no tiene SpacePaymentRule (el cliente aún no da sus montos).
    const { eventTypeId, arcosId, capillaId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2029-10-13', invitados: 150, spaceIds: [arcosId, capillaId], eventTypeId, client: { nombre: 'Plan Incompleto' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const { estadoCuenta } = await loadEstadoCuenta(prisma, q);
    // No se cobra un plan a medias: basta que falte una regla.
    expect(estadoCuenta.planPendiente).toBe(true);
    expect(estadoCuenta.plan).toBeNull();
  });

  it('rechaza más de 3 espacios', async () => {
    const { eventTypeId, arcosId, camposId, cupulaId, capillaId } = await ids();
    await expect(
      createQuote(
        prisma,
        {
          fecha: '2029-09-16',
          invitados: 250,
          spaceIds: [arcosId, camposId, cupulaId, capillaId],
          eventTypeId,
          client: { nombre: 'Cuatro Salones' },
        },
        actor,
      ),
    ).rejects.toThrow();
  });

  it('basta que UNO de varios espacios esté comprometido para rechazar', async () => {
    const { eventTypeId, arcosId, camposId } = await ids();
    const ocupa = await createQuote(
      prisma,
      { fecha: '2029-08-13', invitados: 250, spaceIds: [camposId], eventTypeId, client: { nombre: 'Ocupa Campos' } },
      actor,
    );
    createdQuoteIds.push(ocupa.id);
    createdClientIds.push(ocupa.clientId);
    await updateStatus(prisma, ocupa.id, 'formalizada', actor);

    // Arcos está libre, pero Campos no: la combinación se rechaza.
    await expect(
      createQuote(
        prisma,
        {
          fecha: '2029-08-13',
          invitados: 250,
          spaceIds: [arcosId, camposId],
          eventTypeId,
          client: { nombre: 'Dos Salones Uno Ocupado' },
        },
        actor,
      ),
    ).rejects.toThrow(/no está disponible/i);
  });
});

describe('quotes HTTP', () => {
  it('POST /quotes autenticado => 201; GET /c/:token público => 200', async () => {
    const { eventTypeId, arcosId } = await ids();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
    });
    const cookie = login.cookies[0]!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      cookies: { [cookie.name]: cookie.value },
      payload: {
        fecha: '2030-01-12', // sábado propio (ver nota de fechas aisladas)
        invitados: 250,
        spaceIds: [arcosId],
        eventTypeId,
        client: { nombre: 'Cliente HTTP' },
      },
    });
    expect(res.statusCode).toBe(201);
    const quote = res.json().quote;
    createdQuoteIds.push(quote.id);
    createdClientIds.push(quote.clientId);

    const pub = await app.inject({ method: 'GET', url: `/api/c/${quote.publicToken}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().estadoCuenta.total).toBe(quote.total);
  });

  it('POST /quotes sin auth => 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/quotes', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /quotes sobre un espacio comprometido => 409 con el nombre del salón (no 500)', async () => {
    const { eventTypeId, arcosId } = await ids();
    const ocupa = await createQuote(
      prisma,
      { fecha: '2030-01-26', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Ocupa HTTP' } },
      actor,
    );
    createdQuoteIds.push(ocupa.id);
    createdClientIds.push(ocupa.clientId);
    await updateStatus(prisma, ocupa.id, 'formalizada', actor);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
    });
    const cookie = login.cookies[0]!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      cookies: { [cookie.name]: cookie.value },
      payload: {
        fecha: '2030-01-26',
        invitados: 200,
        spaceIds: [arcosId],
        eventTypeId,
        client: { nombre: 'Encima HTTP' },
      },
    });

    // El error viaja como 409 con un mensaje que dice QUÉ salón está tomado;
    // un 500 dejaría al vendedor sin saber por qué no se guardó.
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/Salón Los Arcos no está disponible/i);
    expect(await prisma.client.count({ where: { nombre: 'Encima HTTP' } })).toBe(0);
  });

  it('PATCH status + PUT edit: se puede cambiar estatus; editar se permite tras apartar y se bloquea tras liquidar', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      // Fecha propia: este caso llega a liquidada, así que deja el espacio
      // comprometido y el servidor ya rechaza cualquier otra cotización ahí.
      { fecha: '2030-01-19', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Ciclo Test' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
    });
    const cookie = login.cookies[0]!;
    const auth = { [cookie.name]: cookie.value };

    // Editar en borrador: OK (cambia invitados => recalcula total)
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/quotes/${q.id}`,
      cookies: auth,
      payload: { fecha: '2030-01-19', invitados: 300, spaceIds: [arcosId], eventTypeId },
    });
    expect(edit.statusCode).toBe(200);

    // Cambiar a formalizada
    const status = await app.inject({
      method: 'PATCH',
      url: `/api/quotes/${q.id}/status`,
      cookies: auth,
      payload: { status: 'formalizada' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().quote.status).toBe('formalizada');

    // Editar tras formalizar: ahora SE PERMITE (deja registro en bitácora)
    const edit2 = await app.inject({
      method: 'PUT',
      url: `/api/quotes/${q.id}`,
      cookies: auth,
      payload: { fecha: '2030-01-19', invitados: 260, spaceIds: [arcosId], eventTypeId },
    });
    expect(edit2.statusCode).toBe(200);

    // Editar tras liquidar: bloqueado (409)
    await app.inject({ method: 'PATCH', url: `/api/quotes/${q.id}/status`, cookies: auth, payload: { status: 'liquidada' } });
    const edit3 = await app.inject({
      method: 'PUT',
      url: `/api/quotes/${q.id}`,
      cookies: auth,
      payload: { fecha: '2030-01-19', invitados: 250, spaceIds: [arcosId], eventTypeId },
    });
    expect(edit3.statusCode).toBe(409);
  });
});

describe('papelera (soft-delete)', () => {
  it('borra borrador → papelera; no-borrador 409; restaurar; excluye de la lista', async () => {
    const { eventTypeId, arcosId } = await ids();
    // Borrador → se puede eliminar
    const q = await createQuote(prisma, { fecha: '2028-03-10', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Papelera Test' } }, actor);
    createdQuoteIds.push(q.id); createdClientIds.push(q.clientId);

    await softDeleteQuote(prisma, q.id, actor);
    const lista1 = await listQuotes(prisma, actor);
    expect(lista1.some((x) => x.id === q.id)).toBe(false); // ya no en la lista

    const trash = await listTrash(prisma, actor);
    expect(trash.some((x) => x.id === q.id)).toBe(true); // sí en la papelera

    await restoreQuote(prisma, q.id, actor);
    const lista2 = await listQuotes(prisma, actor);
    expect(lista2.some((x) => x.id === q.id)).toBe(true); // vuelve a la lista

    // No-borrador → 409
    await updateStatus(prisma, q.id, 'formalizada', actor);
    await expect(softDeleteQuote(prisma, q.id, actor)).rejects.toThrow();

    // La bitácora registró quién eliminó y quién restauró
    const log = await prisma.activityLog.findMany({ where: { quoteId: q.id } });
    expect(log.some((l) => l.tipo === 'eliminada')).toBe(true);
    expect(log.some((l) => l.tipo === 'restaurada')).toBe(true);
  });

  it('no se puede eliminar un borrador con pagos registrados (anti-irregularidades)', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(prisma, { fecha: '2028-03-11', invitados: 150, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Papelera Pagos' } }, actor);
    createdQuoteIds.push(q.id); createdClientIds.push(q.clientId);

    await prisma.payment.create({
      data: { quoteId: q.id, monto: 5000, metodo: 'efectivo', concepto: 'aCuenta', fecha: new Date('2027-01-10T00:00:00.000Z') },
    });
    await expect(softDeleteQuote(prisma, q.id, actor)).rejects.toThrow(/pagos registrados/);

    // Y una cotización en papelera no acepta cambios (solo lectura)
    await prisma.payment.deleteMany({ where: { quoteId: q.id } });
    await softDeleteQuote(prisma, q.id, actor);
    await expect(updateStatus(prisma, q.id, 'formalizada', actor)).rejects.toThrow(/papelera/);
  });
});

describe('datos fiscales (CFDI 4.0)', () => {
  it('guarda los datos fiscales en el cliente y marca requiereFactura', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2029-11-10',
        invitados: 200,
        spaceIds: [camposId],
        eventTypeId,
        requiereFactura: true,
        client: {
          nombre: 'Con Factura',
          rfc: 'GODE561231GR8',
          razonSocial: 'Juan Pérez López',
          regimenFiscal: '612',
          cpFiscal: '53100',
          usoCfdi: 'G03',
          correoFacturacion: 'facturas@ejemplo.com',
        },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    expect(q.requiereFactura).toBe(true);
    const cliente = await prisma.client.findUnique({ where: { id: q.clientId } });
    expect(cliente?.rfc).toBe('GODE561231GR8');
    expect(cliente?.regimenFiscal).toBe('612');
    expect(cliente?.cpFiscal).toBe('53100');
  });

  it('los datos fiscales se reutilizan al buscar el cliente existente', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2029-11-17',
        invitados: 200,
        spaceIds: [camposId],
        eventTypeId,
        client: { nombre: 'Reuso Fiscal', rfc: 'ABC120101XYZ', cpFiscal: '11000' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const res = await app.inject({
      method: 'GET',
      url: '/api/clients?q=Reuso',
      cookies: await authCookies(),
    });
    expect(res.statusCode).toBe(200);
    const encontrado = res.json().clients.find((c: { nombre: string }) => c.nombre === 'Reuso Fiscal');
    expect(encontrado.rfc).toBe('ABC120101XYZ');
    expect(encontrado.cpFiscal).toBe('11000');
  });

  // El caso principal de la tarjeta: el cliente que vuelve y hasta su segundo
  // evento da el RFC. Se manda clientId (se reutiliza) junto con los datos
  // fiscales nuevos, y esos datos tienen que llegar a la base.
  it('captura los datos fiscales de un cliente reutilizado por clientId', async () => {
    const { eventTypeId, camposId } = await ids();
    const primera = await createQuote(
      prisma,
      {
        fecha: '2029-11-24',
        invitados: 150,
        spaceIds: [camposId],
        eventTypeId,
        client: { nombre: 'Vuelve Sin RFC' },
      },
      actor,
    );
    createdQuoteIds.push(primera.id);
    createdClientIds.push(primera.clientId);
    const antes = await prisma.client.findUnique({ where: { id: primera.clientId } });
    expect(antes?.rfc).toBeNull();

    const segunda = await createQuote(
      prisma,
      {
        fecha: '2029-12-01',
        invitados: 150,
        spaceIds: [camposId],
        eventTypeId,
        requiereFactura: true,
        clientId: primera.clientId,
        client: { nombre: 'Vuelve Sin RFC', rfc: 'ABC120101XYZ', cpFiscal: '11000' },
      },
      actor,
    );
    createdQuoteIds.push(segunda.id);

    expect(segunda.clientId).toBe(primera.clientId);
    const despues = await prisma.client.findUnique({ where: { id: primera.clientId } });
    expect(despues?.rfc).toBe('ABC120101XYZ');
    expect(despues?.cpFiscal).toBe('11000');
  });

  // Reutilizar un cliente SIN tocar la tarjeta no debe borrarle lo que ya tenía:
  // el formulario manda los seis campos siempre, con los valores que cargó del
  // propio cliente, así que el rewrite es un no-op. Si algún día el buscador
  // dejara de devolver un campo, llegaría null y este test lo caza.
  it('reutilizar un cliente sin tocar sus datos fiscales no los borra', async () => {
    const { eventTypeId, camposId } = await ids();
    const primera = await createQuote(
      prisma,
      {
        fecha: '2029-12-08',
        invitados: 150,
        spaceIds: [camposId],
        eventTypeId,
        requiereFactura: true,
        client: {
          nombre: 'Vuelve Con RFC',
          rfc: 'GODE561231GR8',
          razonSocial: 'Juan Pérez López',
          regimenFiscal: '612',
          cpFiscal: '53100',
          usoCfdi: 'G03',
          correoFacturacion: 'facturas@ejemplo.com',
        },
      },
      actor,
    );
    createdQuoteIds.push(primera.id);
    createdClientIds.push(primera.clientId);

    // Se pasa por el buscador de verdad en lugar de escribir el payload a mano:
    // así, si el select de GET /clients dejara de devolver un campo fiscal, el
    // formulario mandaría null ahí y este test cazaría el borrado.
    const res = await app.inject({
      method: 'GET',
      url: '/api/clients?q=Vuelve Con RFC',
      cookies: await authCookies(),
    });
    const cargado = res.json().clients.find((c: { nombre: string }) => c.nombre === 'Vuelve Con RFC');
    const comoLoMandaElFormulario = {
      nombre: cargado.nombre,
      rfc: cargado.rfc ?? null,
      razonSocial: cargado.razonSocial ?? null,
      regimenFiscal: cargado.regimenFiscal ?? null,
      cpFiscal: cargado.cpFiscal ?? null,
      usoCfdi: cargado.usoCfdi ?? null,
      correoFacturacion: cargado.correoFacturacion ?? null,
    };

    const segunda = await createQuote(
      prisma,
      {
        fecha: '2029-12-15',
        invitados: 150,
        spaceIds: [camposId],
        eventTypeId,
        clientId: primera.clientId,
        client: comoLoMandaElFormulario,
      },
      actor,
    );
    createdQuoteIds.push(segunda.id);

    const cliente = await prisma.client.findUnique({ where: { id: primera.clientId } });
    expect(cliente?.rfc).toBe('GODE561231GR8');
    expect(cliente?.usoCfdi).toBe('G03');
    expect(cliente?.correoFacturacion).toBe('facturas@ejemplo.com');
  });

  it('sube la Constancia de Situación Fiscal y la devuelve por el proxy', async () => {
    const cliente = await prisma.client.create({ data: { nombre: 'Cliente CSF' } });
    createdClientIds.push(cliente.id);

    const boundary = '----hsaTest';
    const pdf = Buffer.from('%PDF-1.4 constancia de prueba');
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="csf"; filename="csf.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      pdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const auth = await authCookies();
    const up = await app.inject({
      method: 'POST',
      url: `/api/clients/${cliente.id}/csf`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      cookies: auth,
      payload: body,
    });
    expect(up.statusCode).toBe(200);

    const ver = await app.inject({
      method: 'GET',
      url: `/api/clients/${cliente.id}/csf`,
      cookies: auth,
    });
    expect(ver.statusCode).toBe(200);
    expect(ver.headers['content-type']).toContain('application/pdf');
  });

  it('la CSF exige autenticación', async () => {
    const cliente = await prisma.client.create({ data: { nombre: 'Cliente CSF Sin Auth' } });
    createdClientIds.push(cliente.id);
    const res = await app.inject({ method: 'GET', url: `/api/clients/${cliente.id}/csf` });
    expect(res.statusCode).toBe(401);
  });
});
