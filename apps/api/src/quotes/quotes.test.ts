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
  return { eventTypeId: eventType!.id, arcosId: arcos!.id, camposId: campos!.id };
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

  // Saltado hasta la Task 9: hoy createQuoteSchema exige exactamente un espacio,
  // así que la combinación de dos salones no llega al guardia (falla en validación).
  it.skip('basta que UNO de varios espacios esté comprometido para rechazar', async () => {
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
