import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { clonarCatalogo } from '../pricelists/service.js';
import {
  createQuote,
  duplicateQuote,
  expireStaleQuotes,
  getByToken,
  loadEstadoCuenta,
  moverCatalogo,
  softDeleteQuote,
  restoreQuote,
  simularCatalogo,
  listTrash,
  contarPapeleraSinVer,
  marcarPapeleraVista,
  listQuotes,
  moveQuoteDate,
  updateQuote,
  updateStatus,
  type Actor,
} from './service.js';

let app: FastifyInstance;
let actor: Actor;
let ventasId: string;
/** El catálogo que estaba activo antes de estos tests. Se restaura POR ID. */
let activoOriginalId: string;
const ventasEmail = `ventas-quotes-${randomUUID()}@haciendasanandres.com.mx`;
/** El nombre del catálogo es único: un sufijo por corrida evita envenenar la siguiente. */
const SUF = randomUUID().slice(0, 8);
const createdQuoteIds: string[] = [];
const createdClientIds: string[] = [];
const createdPriceListIds: string[] = [];

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

/** Cookie de una vendedora real: `requireAdmin` solo se puede probar con otro rol. */
async function ventasCookies() {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: ventasEmail, password: 'ventas1234' },
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
  const ventas = await prisma.user.create({
    data: {
      nombre: 'Vendedora de cotizaciones',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventasId = ventas.id;
  activoOriginalId = (await prisma.priceList.findFirstOrThrow({ where: { activa: true } })).id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
  await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  // Los catálogos de prueba, de adentro hacia afuera: los FK son RESTRICT y las
  // cotizaciones que los apuntaban ya se borraron arriba.
  await prisma.foodPackagePrice.deleteMany({ where: { package: { priceListId: { in: createdPriceListIds } } } });
  await prisma.foodPackage.deleteMany({ where: { priceListId: { in: createdPriceListIds } } });
  await prisma.addOn.deleteMany({ where: { priceListId: { in: createdPriceListIds } } });
  await prisma.rentalPrice.deleteMany({ where: { priceListId: { in: createdPriceListIds } } });
  await prisma.djHoraExtraPrice.deleteMany({ where: { priceListId: { in: createdPriceListIds } } });
  await prisma.priceList.deleteMany({ where: { id: { in: createdPriceListIds } } });
  // Se restaura por ID y no por año: dos catálogos pueden compartir año, y dejar
  // activo el equivocado represiaría a las suites que corren después.
  await prisma.$transaction([
    prisma.priceList.updateMany({ data: { activa: false } }),
    prisma.priceList.update({ where: { id: activoOriginalId }, data: { activa: true } }),
  ]);
  await prisma.user.delete({ where: { id: ventasId } });
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

describe('contador de papelera (sin ver)', () => {
  /** Espera un instante: el sello de "visto" y el `deletedAt` se comparan con `>`,
   *  y dos escrituras en el MISMO milisegundo harían pasar por "ya visto" algo
   *  que se eliminó después. En la vida real median segundos; aquí, 10 ms. */
  const tic = () => new Promise((r) => setTimeout(r, 10));

  /** Un borrador de la vendedora, ya en la papelera. */
  async function borradorEnPapelera(nombre: string, fecha: string, quien: Actor) {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha, invitados: 150, spaceIds: [arcosId], eventTypeId, client: { nombre } },
      quien,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    await softDeleteQuote(prisma, q.id, quien);
    return q;
  }

  it('sin sello previo, todo lo que está en papelera cuenta', async () => {
    const vendedora: Actor = { id: ventasId, role: 'ventas' };
    // La vendedora nace sin sello: su papelera entera está "sin ver".
    await borradorEnPapelera('Contador Sin Sello 1', '2031-02-08', vendedora);
    await borradorEnPapelera('Contador Sin Sello 2', '2031-02-15', vendedora);
    expect(await contarPapeleraSinVer(prisma, vendedora)).toBe(2);
  });

  it('marcar visto pone el contador en cero', async () => {
    const vendedora: Actor = { id: ventasId, role: 'ventas' };
    await marcarPapeleraVista(prisma, vendedora);
    expect(await contarPapeleraSinVer(prisma, vendedora)).toBe(0);
  });

  it('una cotización eliminada DESPUÉS de marcar visto vuelve a contar', async () => {
    const vendedora: Actor = { id: ventasId, role: 'ventas' };
    await marcarPapeleraVista(prisma, vendedora);
    expect(await contarPapeleraSinVer(prisma, vendedora)).toBe(0);
    await tic();
    await borradorEnPapelera('Contador Después del Sello', '2031-03-01', vendedora);
    expect(await contarPapeleraSinVer(prisma, vendedora)).toBe(1);
  });

  it('restaurar una cotización la saca del contador', async () => {
    const vendedora: Actor = { id: ventasId, role: 'ventas' };
    await marcarPapeleraVista(prisma, vendedora);
    await tic();
    const q = await borradorEnPapelera('Contador Restaurada', '2031-03-08', vendedora);
    expect(await contarPapeleraSinVer(prisma, vendedora)).toBe(1);
    await restoreQuote(prisma, q.id, vendedora);
    expect(await contarPapeleraSinVer(prisma, vendedora)).toBe(0);
  });

  it('las rutas responden: GET cuenta, POST marca visto y deja el contador en cero', async () => {
    const auth = await authCookies(); // el admin de authCookies ES `actor`
    await marcarPapeleraVista(prisma, actor);
    await tic();
    await borradorEnPapelera('Contador Por Ruta', '2031-05-03', actor);

    const antes = await app.inject({ method: 'GET', url: '/api/quotes/trash/sin-ver', cookies: auth });
    expect(antes.statusCode).toBe(200);
    expect(antes.json().count).toBe(1);

    const visto = await app.inject({ method: 'POST', url: '/api/quotes/trash/visto', cookies: auth });
    expect(visto.statusCode).toBe(200);
    expect(visto.json().ok).toBe(true);

    const despues = await app.inject({ method: 'GET', url: '/api/quotes/trash/sin-ver', cookies: auth });
    expect(despues.json().count).toBe(0);
  });

  it('una vendedora no cuenta las de otra; el admin las cuenta todas', async () => {
    const vendedora: Actor = { id: ventasId, role: 'ventas' };
    // Se cuenta por DELTA: la papelera del admin es global y otras suites dejan
    // basura ahí. Lo que se fija es cuánto MUEVE cada eliminación, no el absoluto.
    await marcarPapeleraVista(prisma, vendedora);
    await marcarPapeleraVista(prisma, actor);
    await tic();
    const adminAntes = await contarPapeleraSinVer(prisma, actor);

    // Una del admin: la vendedora no la ve, el admin sí.
    await borradorEnPapelera('Contador Del Admin', '2031-04-05', actor);
    expect(await contarPapeleraSinVer(prisma, vendedora)).toBe(0);
    expect(await contarPapeleraSinVer(prisma, actor)).toBe(adminAntes + 1);

    // Una de la vendedora: la ve ella, y el admin también (ve todo).
    await borradorEnPapelera('Contador De La Vendedora', '2031-04-12', vendedora);
    expect(await contarPapeleraSinVer(prisma, vendedora)).toBe(1);
    expect(await contarPapeleraSinVer(prisma, actor)).toBe(adminAntes + 2);
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
  /**
   * Catálogo clonado del activo con TODOS sus precios multiplicados —renta y DJ
   * por hora extra—, y activado. El DJ va incluido porque era la última puerta
   * de atrás: un precio global que activar un catálogo nuevo no movía.
   */
  async function catalogoCaroYActivo(factor: number, nombre: string) {
    const viejo = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
    const nuevo = await prisma.priceList.create({
      data: {
        // Con sufijo por corrida: `nombre` es único, y una corrida que abortó
        // antes de limpiar dejaba la siguiente muerta en el primer `create`.
        nombre: `${nombre}-${SUF}`,
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
    const dj = await prisma.djHoraExtraPrice.findMany({ where: { priceListId: viejo.id } });
    await prisma.djHoraExtraPrice.createMany({
      data: dj.map((d) => ({
        priceListId: nuevo.id,
        eventTypeId: d.eventTypeId,
        price: d.price * factor,
      })),
    });
    await prisma.$transaction([
      prisma.priceList.updateMany({ data: { activa: false } }),
      prisma.priceList.update({ where: { id: nuevo.id }, data: { activa: true } }),
    ]);
    /** Borra el catálogo caro (hijos primero: los FK son RESTRICT) y reactiva el viejo. */
    const restaurar = () =>
      prisma.$transaction([
        prisma.rentalPrice.deleteMany({ where: { priceListId: nuevo.id } }),
        prisma.djHoraExtraPrice.deleteMany({ where: { priceListId: nuevo.id } }),
        prisma.priceList.delete({ where: { id: nuevo.id } }),
        prisma.priceList.update({ where: { id: viejo.id }, data: { activa: true } }),
      ]);
    return { nuevo, viejo, restaurar };
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
    const { viejo, restaurar } = await catalogoCaroYActivo(3, 'PRUEBA-TRIPLE');

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
      await restaurar();
    }
  });

  // LA prueba que le da sentido a bajar el DJ al catálogo. Antes de esto el
  // precio del DJ era global: activar un catálogo con el DJ al doble represiaba
  // toda cotización con la casilla marcada en cuanto alguien la reeditara.
  it('reeditar NO represia el DJ aunque el catálogo activo lo tenga al doble', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2031-07-12',
        invitados: 200,
        spaceIds: [arcosId],
        eventTypeId,
        horasExtra: 2,
        usaDjHoraExtra: true,
        client: { nombre: 'DJ No Me Represies' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    // El DJ de boda son $2,950/hora: la línea tiene que estar, o la prueba no
    // estaría midiendo nada.
    expect(djDe(q.breakdown)).toBe(2950 * 2);
    const totalOriginal = q.total;

    const { nuevo, viejo } = await catalogoCaroYActivo(2, 'PRUEBA-DJ-DOBLE');
    // El catálogo caro lo barre el `afterAll` y no el `finally`: abajo se crea
    // una cotización que lo apunta, y el FK es RESTRICT.
    createdPriceListIds.push(nuevo.id);
    try {
      const editada = await updateQuote(
        prisma,
        q.id,
        {
          fecha: '2031-07-12',
          invitados: 200,
          spaceIds: [arcosId],
          eventTypeId,
          horasExtra: 2,
          usaDjHoraExtra: true,
          addOns: [],
        },
        actor,
      );
      expect(editada.priceListId).toBe(viejo.id);
      expect(editada.total).toBe(totalOriginal);
      expect(djDe(editada.breakdown)).toBe(2950 * 2); // NO 5,900/hora

      // La otra mitad, y la que distingue este diseño del anterior: el precio
      // del catálogo NUEVO sí manda en lo NUEVO. Con el DJ como precio global
      // esta cotización cobraría $2,950/hora igual que la vieja, y entonces
      // "nada se movió" no probaría nada.
      const recien = await createQuote(
        prisma,
        {
          fecha: '2031-07-19',
          invitados: 200,
          spaceIds: [arcosId],
          eventTypeId,
          horasExtra: 2,
          usaDjHoraExtra: true,
          client: { nombre: 'DJ Al Doble' },
        },
        actor,
      );
      createdQuoteIds.push(recien.id);
      createdClientIds.push(recien.clientId);
      expect(recien.priceListId).toBe(nuevo.id);
      expect(djDe(recien.breakdown)).toBe(5900 * 2);
    } finally {
      // Solo se devuelve la bandera de activo: dejar el caro activo represiaría
      // a las suites que corren después.
      await prisma.$transaction([
        prisma.priceList.updateMany({ data: { activa: false } }),
        prisma.priceList.update({ where: { id: viejo.id }, data: { activa: true } }),
      ]);
    }
  });
});

/** El monto de la línea del DJ en un desglose ya persistido, o `undefined`. */
function djDe(breakdown: unknown): number | undefined {
  const { lines } = breakdown as { lines: { concepto: string; monto: number }[] };
  return lines.find((l) => l.concepto === 'DJ Hora extra')?.monto;
}

describe('mover de catálogo', () => {
  /** Clona el catálogo de una cotización y apunta el clon para el `afterAll`. */
  async function clonCaro(priceListId: string, nombre: string, anio: number, incrementoPct = 100) {
    const clon = await clonarCatalogo(prisma, {
      nombre: `${nombre}-${SUF}`,
      anio,
      clonarDe: priceListId,
      incrementoPct,
    });
    createdPriceListIds.push(clon.id);
    return clon;
  }

  async function cotizacion(fecha: string, nombre: string) {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha, invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    return q;
  }

  it('un admin la mueve, se represia y queda en bitácora', async () => {
    const q = await cotizacion('2032-05-15', 'Mover Catalogo');
    const caro = await clonCaro(q.priceListId, 'CARO', 2092);

    const r = await moverCatalogo(prisma, q.id, caro.id, actor);

    expect(r.antes).toBe(q.total);
    expect(r.despues).toBeGreaterThan(r.antes);
    expect(r.quote.priceListId).toBe(caro.id);
    expect(r.quote.total).toBe(r.despues);

    const logs = await prisma.activityLog.findMany({ where: { quoteId: q.id, tipo: 'catalogo' } });
    expect(logs).toHaveLength(1); // si esto da 0, falta el ALTER TYPE
    expect(logs[0]!.meta).toMatchObject({
      de: q.priceListId,
      a: caro.id,
      totalAntes: r.antes,
      totalDespues: r.despues,
    });
  });

  it('la cotización movida se puede reeditar con los precios del catálogo NUEVO', async () => {
    // Mover y no poder guardar después sería una trampa: el recálculo posterior
    // usa el catálogo fijado, que ahora es el destino.
    const q = await cotizacion('2032-05-22', 'Mover y Reeditar');
    const { eventTypeId, camposId } = await ids();
    const caro = await clonCaro(q.priceListId, 'CARO-REEDITA', 2088);
    const r = await moverCatalogo(prisma, q.id, caro.id, actor);

    const editada = await updateQuote(
      prisma, q.id,
      { fecha: '2032-05-22', invitados: 200, spaceIds: [camposId], eventTypeId, horasExtra: 0, addOns: [] },
      actor,
    );
    expect(editada.priceListId).toBe(caro.id);
    expect(editada.total).toBe(r.despues);
  });

  it('mueve también los servicios y el paquete de alimentos, que en el clon son OTROS registros', async () => {
    // Clonar crea filas NUEVAS: el paquete "SUPREME" de 2028 no es el mismo
    // registro que el de 2027. Sin retraducir los ids, el motor lanza
    // "Paquete de alimentos … no existe" en el primer recálculo.
    const { eventTypeId, camposId } = await ids();
    const paquete = await prisma.foodPackage.findFirstOrThrow({
      where: { nombre: 'SUPREME', eventTypeId, priceList: { activa: true } },
    });
    const servicio = await prisma.addOn.findFirstOrThrow({
      where: { nombre: 'Mesa de dulces (por persona)', priceList: { activa: true } },
    });
    const q = await createQuote(
      prisma,
      {
        fecha: '2032-05-29',
        invitados: 200,
        spaceIds: [camposId],
        eventTypeId,
        foodPackageId: paquete.id,
        addOns: [{ addOnId: servicio.id, cantidad: 1 }],
        client: { nombre: 'Mover Con Alimentos' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const caro = await clonCaro(q.priceListId, 'CARO-ALIMENTOS', 2087);
    const r = await moverCatalogo(prisma, q.id, caro.id, actor);

    expect(r.quote.foodPackageId).not.toBe(paquete.id);
    const paqueteDestino = await prisma.foodPackage.findUniqueOrThrow({
      where: { id: r.quote.foodPackageId! },
    });
    expect(paqueteDestino.priceListId).toBe(caro.id);
    expect(paqueteDestino.nombre).toBe('SUPREME');

    const addOnsGuardados = r.quote.addOns as unknown as { addOnId: string }[];
    expect(addOnsGuardados[0]!.addOnId).not.toBe(servicio.id);
    const servicioDestino = await prisma.addOn.findUniqueOrThrow({
      where: { id: addOnsGuardados[0]!.addOnId },
    });
    expect(servicioDestino.priceListId).toBe(caro.id);

    // Y la cotización movida sigue siendo recalculable.
    const editada = await updateQuote(
      prisma, q.id,
      {
        fecha: '2032-05-29', invitados: 200, spaceIds: [camposId], eventTypeId, horasExtra: 0,
        foodPackageId: r.quote.foodPackageId!,
        addOns: [{ addOnId: addOnsGuardados[0]!.addOnId, cantidad: 1 }],
      },
      actor,
    );
    expect(editada.total).toBe(r.despues);
  });

  it('un vendedor no puede', async () => {
    const q = await cotizacion('2032-06-05', 'Mover Sin Permiso');
    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${q.id}/catalogo`,
      cookies: await ventasCookies(),
      payload: { priceListId: q.priceListId },
    });
    expect(res.statusCode).toBe(403);

    const sinTocar = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(sinTocar.priceListId).toBe(q.priceListId);
  });

  it('un catálogo inexistente da 404 y no toca la cotización', async () => {
    const q = await cotizacion('2032-06-12', 'Mover A Ninguna Parte');
    await expect(moverCatalogo(prisma, q.id, 'no-existe', actor)).rejects.toMatchObject({ status: 404 });
    const sinTocar = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(sinTocar.priceListId).toBe(q.priceListId);
    expect(sinTocar.total).toBe(q.total);
  });

  it('una cotización en la papelera no se mueve de catálogo', async () => {
    const q = await cotizacion('2032-06-19', 'Mover En Papelera');
    const caro = await clonCaro(q.priceListId, 'CARO-PAPELERA', 2086);
    await softDeleteQuote(prisma, q.id, actor);

    await expect(moverCatalogo(prisma, q.id, caro.id, actor)).rejects.toThrow(/papelera/i);
    const sinTocar = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(sinTocar.priceListId).toBe(q.priceListId);
  });

  it('simular da el mismo antes/después que mover, sin tocar nada', async () => {
    // El número que el modal enseña ANTES de confirmar tiene que ser el mismo
    // que se guarda. Si difieren, la interfaz miente sobre dinero.
    const q = await cotizacion('2032-07-03', 'Simular Catalogo');
    const caro = await clonCaro(q.priceListId, 'CARO-SIMULA', 2084);

    const previa = await simularCatalogo(prisma, q.id, caro.id, actor);
    expect(previa.antes).toBe(q.total);
    expect(previa.despues).toBeGreaterThan(previa.antes);

    // Nada se escribió: ni la cotización ni la bitácora.
    const sinTocar = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(sinTocar.priceListId).toBe(q.priceListId);
    expect(sinTocar.total).toBe(q.total);
    expect(await prisma.activityLog.count({ where: { quoteId: q.id, tipo: 'catalogo' } })).toBe(0);

    const real = await moverCatalogo(prisma, q.id, caro.id, actor);
    expect(real.antes).toBe(previa.antes);
    expect(real.despues).toBe(previa.despues);
  });

  it('simular respeta los mismos permisos y errores que mover', async () => {
    const q = await cotizacion('2032-07-10', 'Simular Sin Permiso');
    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${q.id}/catalogo/simular`,
      cookies: await ventasCookies(),
      payload: { priceListId: q.priceListId },
    });
    expect(res.statusCode).toBe(403);

    await expect(simularCatalogo(prisma, q.id, 'no-existe', actor)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('un admin la mueve por HTTP y recibe el antes y el después', async () => {
    const q = await cotizacion('2032-06-26', 'Mover HTTP');
    const caro = await clonCaro(q.priceListId, 'CARO-HTTP', 2085);

    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${q.id}/catalogo`,
      cookies: await authCookies(),
      payload: { priceListId: caro.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().antes).toBe(q.total);
    expect(res.json().despues).toBeGreaterThan(q.total);
    expect(res.json().quote.priceListId).toBe(caro.id);
  });
});

/** Una línea completa de un desglose ya persistido, buscada por concepto exacto. */
function lineaDe(breakdown: unknown, concepto: string) {
  const { lines } = breakdown as {
    lines: { concepto: string; detalle?: string; monto: number; ivaIncluido: boolean; grupo?: string }[];
  };
  return lines.find((l) => l.concepto === concepto);
}

// ---------------------------------------------------------------------------
// Servicio suelto del evento (punto 2 del Plan G). No es un add-on del catálogo:
// vive en LA cotización. Lo que estas pruebas fijan es que el dinero cae donde
// debe —en `otros`, nunca en la renta— y que sobrevive a editar, duplicar y
// mover de catálogo.
// ---------------------------------------------------------------------------
describe('servicios sueltos del evento (extras)', () => {
  const extraMenu = { nombre: 'Cambio de menú', kind: 'porPersona' as const, monto: 200, cantidad: 1 };

  it('se guardan, salen en el desglose y suman al total con IVA incluido', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2032-02-14',
        invitados: 250,
        spaceIds: [arcosId],
        eventTypeId,
        extras: [extraMenu],
        client: { nombre: 'Extra Menú' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const guardados = await prisma.quoteExtra.findMany({ where: { quoteId: q.id } });
    expect(guardados).toHaveLength(1);
    expect(guardados[0]!.monto).toBe(200);
    expect(guardados[0]!.kind).toBe('porPersona');

    const linea = lineaDe(q.breakdown, 'Cambio de menú');
    expect(linea?.monto).toBe(200 * 250);
    expect(linea?.grupo).toBe('otros');
    expect(linea?.ivaIncluido).toBe(true);
  });

  // LA prueba del punto: un extra NO puede mover el plan de pagos. Si entrara a
  // la renta cambiaría la base del complemento de todo evento que use un extra.
  it('no entra a la base del complemento: el plan de pagos no se mueve', async () => {
    const { eventTypeId, arcosId } = await ids();
    const base = { fecha: '2032-03-13', invitados: 250, spaceIds: [arcosId], eventTypeId };

    const sin = await createQuote(prisma, { ...base, client: { nombre: 'Sin extra' } }, actor);
    createdQuoteIds.push(sin.id);
    createdClientIds.push(sin.clientId);
    const con = await createQuote(
      prisma,
      { ...base, fecha: '2032-03-20', extras: [extraMenu], client: { nombre: 'Con extra' } },
      actor,
    );
    createdQuoteIds.push(con.id);
    createdClientIds.push(con.clientId);

    // La renta no se movió; el total sí, exactamente por el monto del extra.
    expect(con.rentaTotal).toBe(sin.rentaTotal);
    expect(con.total).toBe(sin.total + 200 * 250);

    const ecSin = await loadEstadoCuenta(prisma, sin);
    const ecCon = await loadEstadoCuenta(prisma, con);
    // El estado de cuenta se mide SOLO sobre la renta: mismo total y mismo plan.
    expect(ecCon.estadoCuenta.total).toBe(ecSin.estadoCuenta.total);
    const hito = (ec: typeof ecSin, key: string) =>
      ec.estadoCuenta.plan?.find((m) => m.key === key)?.objetivo;
    expect(hito(ecCon, 'apartar')).toBe(hito(ecSin, 'apartar'));
    expect(hito(ecCon, 'complemento')).toBe(hito(ecSin, 'complemento'));
    expect(hito(ecCon, 'finiquito')).toBe(hito(ecSin, 'finiquito'));
  });

  it('al reeditar sobreviven: se reemplazan por los que manda el formulario', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2032-04-10', invitados: 250, spaceIds: [arcosId], eventTypeId, extras: [extraMenu], client: { nombre: 'Extra Editable' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const editada = await updateQuote(
      prisma,
      q.id,
      {
        fecha: '2032-04-10',
        invitados: 250,
        spaceIds: [arcosId],
        eventTypeId,
        extras: [{ ...extraMenu, monto: 300 }, { nombre: 'Grúa', kind: 'fijo', monto: 7500, cantidad: 1 }],
      },
      actor,
    );
    const guardados = await prisma.quoteExtra.findMany({ where: { quoteId: q.id }, orderBy: { monto: 'asc' } });
    expect(guardados.map((e) => e.monto)).toEqual([300, 7500]); // no quedaron duplicados del anterior
    expect(lineaDe(editada.breakdown, 'Cambio de menú')?.monto).toBe(300 * 250);
    expect(lineaDe(editada.breakdown, 'Grúa')?.monto).toBe(7500);
  });

  it('duplicar la cotización copia los extras', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2032-05-08', invitados: 250, spaceIds: [arcosId], eventTypeId, extras: [extraMenu], client: { nombre: 'Extra Duplicable' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const copia = await duplicateQuote(prisma, q.id, actor);
    createdQuoteIds.push(copia.id);
    const copiados = await prisma.quoteExtra.findMany({ where: { quoteId: copia.id } });
    expect(copiados).toHaveLength(1);
    expect(copiados[0]!.nombre).toBe('Cambio de menú');
    expect(copia.total).toBe(q.total);
  });

  it('un monto con decimales se rechaza (Postgres truncaría el flotante sin avisar)', async () => {
    const { eventTypeId, arcosId } = await ids();
    await expect(
      createQuote(
        prisma,
        {
          fecha: '2032-06-12',
          invitados: 250,
          spaceIds: [arcosId],
          eventTypeId,
          extras: [{ ...extraMenu, monto: 200.5 }],
          client: { nombre: 'Extra Roto' },
        },
        actor,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Descuento de cortesía (punto 7 del Plan G). `esCortesia` NUNCA había afectado
// el precio; esto se lo da. Pega SOLO sobre la renta.
// ---------------------------------------------------------------------------
describe('descuento de cortesía', () => {
  it('se guarda con su motivo y deja la renta en cero al 100%', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2032-07-10',
        invitados: 250,
        spaceIds: [arcosId],
        eventTypeId,
        esCortesia: true,
        descuentoPct: 100,
        descuentoMotivo: 'Boda de la hija del dueño',
        client: { nombre: 'Cortesía Total' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    expect(q.descuentoPct).toBe(100);
    expect(q.descuentoMotivo).toBe('Boda de la hija del dueño');
    expect(q.rentaTotal).toBe(0);
    expect(q.total).toBe(0);
    const linea = lineaDe(q.breakdown, 'Descuento de cortesía (100% renta)');
    expect(linea?.grupo).toBe('renta');
    expect(linea?.detalle).toBe('Boda de la hija del dueño');
  });

  it('un descuento sin motivo se rechaza: sin explicación no es auditable', async () => {
    const { eventTypeId, arcosId } = await ids();
    await expect(
      createQuote(
        prisma,
        {
          fecha: '2032-08-14',
          invitados: 250,
          spaceIds: [arcosId],
          eventTypeId,
          descuentoPct: 50,
          client: { nombre: 'Sin Motivo' },
        },
        actor,
      ),
    ).rejects.toThrow(/motivo/i);
  });

  it('un porcentaje fuera de 0..100 se rechaza', async () => {
    const { eventTypeId, arcosId } = await ids();
    await expect(
      createQuote(
        prisma,
        {
          fecha: '2032-09-11',
          invitados: 250,
          spaceIds: [arcosId],
          eventTypeId,
          descuentoPct: 120,
          descuentoMotivo: 'Más que gratis',
          client: { nombre: 'Ciento Veinte' },
        },
        actor,
      ),
    ).rejects.toThrow();
  });

  // `esCortesia` se sigue guardando solo (marca el evento en verde en la agenda);
  // el precio lo mueve el porcentaje, no la casilla. Marcar cortesía sin capturar
  // porcentaje NO cambia el dinero, que es como se comportaba hasta hoy.
  it('esCortesia sin porcentaje sigue sin afectar el precio', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2032-10-09', invitados: 250, spaceIds: [arcosId], eventTypeId, esCortesia: true, client: { nombre: 'Cortesía Sin Descuento' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    expect(q.esCortesia).toBe(true);
    expect(q.descuentoPct).toBeNull();
    const cortesia = (q.breakdown as { lines: { concepto: string }[] }).lines.filter((l) =>
      l.concepto.startsWith('Descuento de cortesía'),
    );
    expect(cortesia).toHaveLength(0);
    // Los 108,500 de folleto, intactos.
    expect(q.rentaTotal).toBe(108500);
  });

  it('el descuento baja la base del complemento: es renta que ya no se va a cobrar', async () => {
    const { eventTypeId, arcosId } = await ids();
    const base = { invitados: 250, spaceIds: [arcosId], eventTypeId };
    const sin = await createQuote(prisma, { ...base, fecha: '2032-11-13', client: { nombre: 'Renta Completa' } }, actor);
    createdQuoteIds.push(sin.id);
    createdClientIds.push(sin.clientId);
    const con = await createQuote(
      prisma,
      { ...base, fecha: '2032-11-20', descuentoPct: 50, descuentoMotivo: 'Media cortesía', client: { nombre: 'Media Renta' } },
      actor,
    );
    createdQuoteIds.push(con.id);
    createdClientIds.push(con.clientId);

    expect(con.rentaTotal).toBe(Math.round(sin.rentaTotal / 2));
    const ec = await loadEstadoCuenta(prisma, con);
    expect(ec.estadoCuenta.total).toBe(con.rentaTotal);
  });

  it('quitar el descuento al reeditar devuelve la renta completa', async () => {
    const { eventTypeId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2032-12-11',
        invitados: 250,
        spaceIds: [arcosId],
        eventTypeId,
        descuentoPct: 100,
        descuentoMotivo: 'Cortesía que se cancela',
        client: { nombre: 'Cortesía Revocable' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    expect(q.rentaTotal).toBe(0);

    const editada = await updateQuote(
      prisma,
      q.id,
      { fecha: '2032-12-11', invitados: 250, spaceIds: [arcosId], eventTypeId },
      actor,
    );
    expect(editada.descuentoPct).toBeNull();
    expect(editada.descuentoMotivo).toBeNull();
    expect(editada.rentaTotal).toBe(108500);
  });
});

// ---------------------------------------------------------------------------
// El contrato imprime los renglones del GRUPO `renta` y, como pie, el total de
// renta del DESGLOSE. Este test fija la aritmética de esa tabla: la suma de los
// renglones tiene que ser exactamente el total impreso.
//
// Es la red del arreglo de `ContratoPage`: antes filtraba por texto del concepto
// ('Renta ' y 'Horas extra'), así que la Capilla no se imprimía nunca y todo
// sábado con capilla sacaba una tabla que sumaba $5,000 menos que su total, en un
// documento que se firma. Si alguien vuelve a filtrar por texto —o si el motor
// gana un renglón de renta— este test no lo ve, pero sí ve que el desglose y su
// total sigan cuadrando, que es la invariante de la que depende la tabla.
// ---------------------------------------------------------------------------
describe('el contrato cuadra: renglones de renta contra su total', () => {
  it('capilla + horas extra + descuento: los renglones suman el total del desglose', async () => {
    const { eventTypeId, arcosId } = await ids();
    const paquete = await prisma.foodPackage.findFirstOrThrow({
      where: { nombre: 'SUPREME', eventTypeId, priceList: { activa: true } },
    });
    const q = await createQuote(
      prisma,
      {
        fecha: '2033-01-08', // sábado: la capilla se cobra
        invitados: 250,
        spaceIds: [arcosId],
        eventTypeId,
        horasExtra: 2,
        usaCapilla: true,
        foodPackageId: paquete.id,
        descuentoPct: 50,
        descuentoMotivo: 'Boda de la sobrina',
        client: { nombre: 'Contrato Que Cuadra' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const breakdown = q.breakdown as unknown as {
      lines: { concepto: string; monto: number; grupo?: string }[];
      rentaTotal: number;
    };
    const renta = breakdown.lines.filter((l) => l.grupo === 'renta');

    // Los cinco renglones, con su número, en el orden en que se imprimen.
    expect(renta.map((l) => [l.concepto, l.monto])).toEqual([
      ['Renta Salón Los Arcos', 108500],
      ['Descuento de cortesía (50% renta)', -54250],
      ['Horas extra', 5425],
      ['Capilla', 5000],
      ['Descuento por alimentos (5% renta)', -2712.5],
    ]);

    // 108,500 − 54,250 + 5,425 + 5,000 − 2,712.50 = 61,962.50
    const suma = renta.reduce((s, l) => s + l.monto, 0);
    expect(suma).toBe(61962.5);
    expect(breakdown.rentaTotal).toBe(61962.5);

    // Y por esto el pie del contrato imprime el total del DESGLOSE y no la
    // columna: la columna es entera y aquí redondea medio peso hacia arriba.
    expect(q.rentaTotal).toBe(61963);
  });
});

// ---------------------------------------------------------------------------
// Código de evento (punto 5 del Plan G): `17ENE-CBOLADO-CUPULA`. La función pura
// y su formato están fijados en `packages/shared/src/codigoEvento.test.ts`; aquí
// se prueba lo que necesita la base: unicidad, generación y CONGELADO.
// ---------------------------------------------------------------------------
describe('código de evento', () => {
  it('createQuote lo genera con el formato pedido por el dueño', async () => {
    const { eventTypeId, cupulaId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2034-01-17',
        invitados: 250,
        spaceIds: [cupulaId],
        eventTypeId,
        client: { nombre: 'Carlos Bolado' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    expect(q.codigo).toBe('17ENE-CBOLADO-CUPULA');
  });

  it('dos eventos del mismo cliente, misma fecha y mismo salón: sufijo, y el guardado no truena', async () => {
    const { eventTypeId, cupulaId } = await ids();
    const base = { fecha: '2034-02-20', invitados: 250, spaceIds: [cupulaId], eventTypeId };
    const uno = await createQuote(prisma, { ...base, client: { nombre: 'Colisión Exacta' } }, actor);
    createdQuoteIds.push(uno.id);
    createdClientIds.push(uno.clientId);
    // El MISMO cliente, la MISMA fecha y el MISMO salón: raro, pero posible.
    const dos = await createQuote(prisma, { ...base, clientId: uno.clientId }, actor);
    createdQuoteIds.push(dos.id);
    const tres = await createQuote(prisma, { ...base, clientId: uno.clientId }, actor);
    createdQuoteIds.push(tres.id);

    expect(uno.codigo).toBe('20FEB-CEXACTA-CUPULA');
    expect(dos.codigo).toBe('20FEB-CEXACTA-CUPULA-2');
    expect(tres.codigo).toBe('20FEB-CEXACTA-CUPULA-3');
  });

  it('el código se CONGELA al formalizar: cambiar la fecha ya no lo mueve', async () => {
    const { eventTypeId, cupulaId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2034-03-14',
        invitados: 250,
        spaceIds: [cupulaId],
        eventTypeId,
        client: { nombre: 'Frida Congelada' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    expect(q.codigo).toBe('14MAR-FCONGELADA-CUPULA');

    // En borrador todavía se regenera: el código sigue a la fecha.
    const movida = await updateQuote(
      prisma,
      q.id,
      { fecha: '2034-03-21', invitados: 250, spaceIds: [cupulaId], eventTypeId },
      actor,
    );
    expect(movida.codigo).toBe('21MAR-FCONGELADA-CUPULA');

    // Con compromiso de pago queda fijo: ya está impreso en recibos y contratos.
    await updateStatus(prisma, q.id, 'formalizada', actor);
    const editada = await updateQuote(
      prisma,
      q.id,
      { fecha: '2034-04-11', invitados: 250, spaceIds: [cupulaId], eventTypeId },
      actor,
    );
    expect(editada.fechaEvento.toISOString().slice(0, 10)).toBe('2034-04-11');
    expect(editada.codigo).toBe('21MAR-FCONGELADA-CUPULA');

    // Y tampoco lo mueve el arrastre en la agenda, que es el otro camino a la fecha.
    const arrastrada = await moveQuoteDate(prisma, q.id, '2034-05-09', actor);
    expect(arrastrada.fechaEvento.toISOString().slice(0, 10)).toBe('2034-05-09');
    expect(arrastrada.codigo).toBe('21MAR-FCONGELADA-CUPULA');
  });

  it('en borrador, cambiar el cliente o el espacio también mueve el código', async () => {
    const { eventTypeId, cupulaId, arcosId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2034-06-13',
        invitados: 250,
        spaceIds: [cupulaId],
        eventTypeId,
        client: { nombre: 'Ana Movible' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    expect(q.codigo).toBe('13JUN-AMOVIBLE-CUPULA');

    const otroEspacio = await updateQuote(
      prisma,
      q.id,
      { fecha: '2034-06-13', invitados: 250, spaceIds: [arcosId], eventTypeId },
      actor,
    );
    expect(otroEspacio.codigo).toBe('13JUN-AMOVIBLE-ARCOS');

    const otroNombre = await updateQuote(
      prisma,
      q.id,
      {
        fecha: '2034-06-13',
        invitados: 250,
        spaceIds: [arcosId],
        eventTypeId,
        client: { nombre: 'Ana Recapturada' },
      },
      actor,
    );
    expect(otroNombre.codigo).toBe('13JUN-ARECAPTURADA-ARCOS');
  });

  it('el duplicado nace con su propio código, no con el del original', async () => {
    const { eventTypeId, cupulaId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2034-07-11',
        invitados: 250,
        spaceIds: [cupulaId],
        eventTypeId,
        client: { nombre: 'Diego Duplicado' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    const dup = await duplicateQuote(prisma, q.id, actor);
    createdQuoteIds.push(dup.id);

    expect(q.codigo).toBe('11JUL-DDUPLICADO-CUPULA');
    expect(dup.codigo).toBe('11JUL-DDUPLICADO-CUPULA-2');
  });
});
