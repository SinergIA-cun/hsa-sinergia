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
  moveQuoteDate,
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
  // Balcones es el espacio SIN SpacePaymentRule (ver data/payment-rules.ts) y el
  // cuarto salón para probar el tope. Antes se usaba La Capilla, que dejó de ser
  // un espacio: es la casilla por evento con tarifa de sábado.
  const balcones = await prisma.space.findFirst({ where: { nombre: 'Salón Los Balcones' } });
  return {
    eventTypeId: eventType!.id,
    arcosId: arcos!.id,
    camposId: campos!.id,
    cupulaId: cupula!.id,
    balconesId: balcones!.id,
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

  it('con horas extra, la suma de las rentas por salón es exactamente la renta total', async () => {
    // Las horas extra entran a `rentaTotal` sin `spaceId`. Sin prorrateo la suma
    // de las bases se quedaría corta y el complemento bajaría.
    const { eventTypeId, arcosId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2029-11-03',
        invitados: 250,
        spaceIds: [arcosId, camposId],
        eventTypeId,
        horasExtra: 2,
        client: { nombre: 'Prorrateo Horas Extra' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const { estadoCuenta } = await loadEstadoCuenta(prisma, q);
    const comp = estadoCuenta.plan!.find((m) => m.key === 'complemento')!;
    const sumaBases = comp.desglose!.reduce((s, d) => s + d.rentaBase, 0);
    expect(Math.round(sumaBases * 100) / 100).toBe(q.rentaTotal);

    // Y el dinero no se movió: `Σ pct_i × base_i` tiene que dar lo mismo que el
    // viejo `pctPonderado × rentaTotal` calculado sobre la renta de catálogo.
    const lineas = (q.breakdown as { lines: { spaceId?: string; monto?: number }[] }).lines;
    const catalogo = new Map<string, number>();
    for (const l of lineas) {
      if (l.spaceId && typeof l.monto === 'number') {
        catalogo.set(l.spaceId, (catalogo.get(l.spaceId) ?? 0) + l.monto);
      }
    }
    const sumaCatalogo = [...catalogo.values()].reduce((s, v) => s + v, 0);
    const pctPonderado = comp.desglose!.reduce(
      (s, d) => s + d.pct * ((catalogo.get(d.spaceId) ?? 0) / sumaCatalogo),
      0,
    );
    const objApartar = estadoCuenta.plan!.find((m) => m.key === 'apartar')!.objetivo;
    const viejo = objApartar + Math.round(pctPonderado * q.rentaTotal);
    // Redondear por salón puede diferir de redondear la suma en un peso o dos.
    expect(Math.abs(comp.objetivo - viejo)).toBeLessThanOrEqual(2);
  });

  it('si un salón del evento no tiene regla, el plan queda pendiente', async () => {
    // Los Balcones no tiene SpacePaymentRule (el cliente aún no da sus montos).
    const { eventTypeId, arcosId, balconesId } = await ids();
    // 40 invitados: es el rango que Los Balcones sí cubre (1–50 y 51–70).
    const q = await createQuote(
      prisma,
      { fecha: '2029-10-13', invitados: 40, spaceIds: [arcosId, balconesId], eventTypeId, client: { nombre: 'Plan Incompleto' } },
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
    const { eventTypeId, arcosId, camposId, cupulaId, balconesId } = await ids();
    await expect(
      createQuote(
        prisma,
        {
          fecha: '2029-09-16',
          invitados: 250,
          spaceIds: [arcosId, camposId, cupulaId, balconesId],
          eventTypeId,
          client: { nombre: 'Cuatro Salones' },
        },
        actor,
      ),
      // Por el tope, no por un rango de renta que le falte al cuarto salón.
    ).rejects.toThrow(/Máximo 3 espacios/);
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

  it('mover la fecha recalcula el total según el tipo de día', async () => {
    const { eventTypeId, camposId } = await ids();
    // 2029-12-01 es sábado; 2029-12-04 es martes (domAJue, más barato).
    const q = await createQuote(
      prisma,
      { fecha: '2029-12-01', invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre: 'Mover Fecha' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    const totalSabado = q.total;

    const movida = await moveQuoteDate(prisma, q.id, '2029-12-04', actor);
    expect(movida.fechaEvento.toISOString().slice(0, 10)).toBe('2029-12-04');
    expect(movida.total).toBeLessThan(totalSabado);
  });

  it('no se puede mover una cotización liquidada', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      // 2030-02: ventana libre. Las fechas de diciembre las ocupan los tests
      // fiscales, y "liquidada" bloquea la disponibilidad de ese día.
      { fecha: '2030-02-09', invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre: 'Mover Liquidada' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    await updateStatus(prisma, q.id, 'liquidada', actor);

    await expect(moveQuoteDate(prisma, q.id, '2030-02-16', actor)).rejects.toThrow(/liquidada/i);
  });

  it('no se puede mover a una fecha donde el espacio está comprometido', async () => {
    const { eventTypeId, cupulaId } = await ids();
    const ocupa = await createQuote(
      prisma,
      { fecha: '2029-12-22', invitados: 200, spaceIds: [cupulaId], eventTypeId, client: { nombre: 'Ocupa Destino' } },
      actor,
    );
    createdQuoteIds.push(ocupa.id);
    createdClientIds.push(ocupa.clientId);
    await updateStatus(prisma, ocupa.id, 'formalizada', actor);

    const mover = await createQuote(
      prisma,
      { fecha: '2029-12-29', invitados: 200, spaceIds: [cupulaId], eventTypeId, client: { nombre: 'Quiere Mover' } },
      actor,
    );
    createdQuoteIds.push(mover.id);
    createdClientIds.push(mover.clientId);

    await expect(moveQuoteDate(prisma, mover.id, '2029-12-22', actor)).rejects.toThrow(/no está disponible/i);
  });

  it('el movimiento queda en la bitácora con las dos fechas', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2030-01-12', invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre: 'Bitacora Mover' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    await moveQuoteDate(prisma, q.id, '2030-01-19', actor);
    const log = await prisma.activityLog.findFirst({
      where: { quoteId: q.id, tipo: 'edicion', descripcion: { contains: 'Fecha' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.descripcion).toContain('2030-01-12');
    expect(log!.descripcion).toContain('2030-01-19');
  });

  it('la bitácora de edición registra el antes y después de espacios e invitados', async () => {
    const { eventTypeId, arcosId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2030-03-09', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Bitacora Rica' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    await updateQuote(
      prisma, q.id,
      { fecha: '2030-03-09', invitados: 260, spaceIds: [arcosId, camposId], eventTypeId, horasExtra: 0, addOns: [] },
      actor,
    );

    const log = await prisma.activityLog.findFirst({
      where: { quoteId: q.id, tipo: 'edicion' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    const meta = log!.meta as Record<string, unknown>;
    expect(meta.invitadosAntes).toBe(200);
    expect(meta.invitadosDespues).toBe(260);
    expect(meta.espaciosAntes).toEqual([arcosId]);
    expect(meta.espaciosDespues).toEqual([arcosId, camposId]);
  });

  it('guardar sin cambiar nada no ensucia la bitácora', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2030-03-16', invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre: 'Sin Cambios' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    await updateQuote(
      prisma, q.id,
      { fecha: '2030-03-16', invitados: 200, spaceIds: [camposId], eventTypeId, horasExtra: 0, addOns: [] },
      actor,
    );

    const ediciones = await prisma.activityLog.count({ where: { quoteId: q.id, tipo: 'edicion' } });
    expect(ediciones).toBe(0);
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

describe('casamiento con el catálogo', () => {
  /** Catálogo clonado del activo con la renta multiplicada, y activado. */
  async function catalogoCaroYActivo(factor: number, nombre: string) {
    const viejo = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
    const nuevo = await prisma.priceList.create({
      data: {
        nombre,
        anio: 2099,
        activa: false,
        ivaRate: viejo.ivaRate,
        extraHourRate: viejo.extraHourRate,
        foodDiscountRate: viejo.foodDiscountRate,
        capillaSabado: viejo.capillaSabado,
      },
    });
    const rentas = await prisma.rentalPrice.findMany({ where: { priceListId: viejo.id } });
    await prisma.rentalPrice.createMany({
      data: rentas.map((r) => ({
        priceListId: nuevo.id,
        spaceId: r.spaceId,
        tipo: r.tipo,
        min: r.min,
        max: r.max,
        viernes: r.viernes * factor,
        viernesEspecial: r.viernesEspecial * factor,
        sabado: r.sabado * factor,
        domAJue: r.domAJue * factor,
      })),
    });
    await prisma.$transaction([
      prisma.priceList.updateMany({ data: { activa: false } }),
      prisma.priceList.update({ where: { id: nuevo.id }, data: { activa: true } }),
    ]);
    return { nuevo, viejo };
  }

  it('crear una cotización fija el catálogo activo', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2031-03-15', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Casada al catálogo' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    const activo = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
    expect(q.priceListId).toBe(activo.id);
  });

  it('reeditar usa el catálogo FIJADO, no el activo', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2031-04-19', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'No me represies' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    const totalOriginal = q.total;
    const { nuevo, viejo } = await catalogoCaroYActivo(3, 'PRUEBA-TRIPLE');

    try {
      // Se edita SOLO el nombre del cliente: nada que justifique un cambio de precio.
      const editada = await updateQuote(
        prisma,
        q.id,
        { fecha: '2031-04-19', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Sigo igual' } },
        actor,
      );
      expect(editada.priceListId).toBe(viejo.id);
      expect(editada.total).toBe(totalOriginal);
    } finally {
      await prisma.$transaction([
        prisma.rentalPrice.deleteMany({ where: { priceListId: nuevo.id } }),
        prisma.priceList.delete({ where: { id: nuevo.id } }),
        prisma.priceList.update({ where: { id: viejo.id }, data: { activa: true } }),
      ]);
    }
  });
});
