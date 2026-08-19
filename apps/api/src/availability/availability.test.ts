import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, updateStatus, type Actor } from '../quotes/service.js';
import { getAvailability, getAgenda } from './service.js';

let actor: Actor;
let arcosId: string;
let eventTypeId: string;
const created: string[] = [];
const createdClients: string[] = [];
const FECHA = '2029-03-10'; // fecha aislada para el test

beforeAll(async () => {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  const arcos = await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } });
  const boda = await prisma.eventType.findFirst({ where: { slug: 'boda' } });
  arcosId = arcos!.id;
  eventTypeId = boda!.id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: created } } });
  await prisma.quote.deleteMany({ where: { id: { in: created } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClients } } });
});

describe('getAvailability', () => {
  it('escala el nivel: libre → cotizaciones → bloqueada, y excluye la propia', async () => {
    const libre = await getAvailability(prisma, FECHA, [arcosId]);
    expect(libre.spaces[0]!.level).toBe('libre');

    const q = await createQuote(
      prisma,
      { fecha: FECHA, invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Dispo Test' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);

    // Cotización sin pago: avisa pero no bloquea.
    const conCotizacion = await getAvailability(prisma, FECHA, [arcosId]);
    expect(conCotizacion.spaces[0]!.level).toBe('cotizaciones');
    expect(conCotizacion.blocked).toBe(false);

    // Formalizada (pagó el anticipo): a partir de aquí bloquea.
    await updateStatus(prisma, q.id, 'formalizada', actor);
    const formalizada = await getAvailability(prisma, FECHA, [arcosId]);
    expect(formalizada.spaces[0]!.level).toBe('bloqueada');
    expect(formalizada.blocked).toBe(true);

    // Complementada sigue bloqueando.
    await updateStatus(prisma, q.id, 'complementada', actor);
    expect((await getAvailability(prisma, FECHA, [arcosId])).spaces[0]!.level).toBe('bloqueada');

    // Excluyéndose a sí misma, el espacio vuelve a verse libre (caso de edición).
    const excluida = await getAvailability(prisma, FECHA, [arcosId], q.id);
    expect(excluida.spaces[0]!.level).toBe('libre');
    expect(excluida.blocked).toBe(false);
  });

  it('capillaEventos: informa (sin bloquear) qué otros eventos usan la capilla ese día', async () => {
    const FECHA_CAP = '2029-04-15';
    expect((await getAvailability(prisma, FECHA_CAP, [arcosId])).capillaEventos).toHaveLength(0);

    const q = await createQuote(
      prisma,
      { fecha: FECHA_CAP, invitados: 200, spaceIds: [arcosId], eventTypeId, usaCapilla: true, capillaHorario: '13:00', client: { nombre: 'Capilla Test' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);

    const info = await getAvailability(prisma, FECHA_CAP, [arcosId]);
    expect(info.capillaEventos).toHaveLength(1);
    expect(info.capillaEventos[0]!.cliente).toBe('Capilla Test');
    expect(info.capillaEventos[0]!.horario).toBe('13:00');
    // Excluyendo la propia, no se lista a sí misma (para editar sin ruido).
    expect((await getAvailability(prisma, FECHA_CAP, [arcosId], q.id)).capillaEventos).toHaveLength(0);
  });

  /**
   * Punto 8: se fue `vencida`, y con ella el filtro `status: { not: 'vencida' }`
   * que era lo único que limpiaba los colores y la agenda. La consecuencia la
   * aceptó el dueño: un borrador viejo sigue pintando su fecha. Esto lo fija —
   * si alguien "arregla" la agenda escondiendo borradores viejos, aquí truena.
   */
  it('un borrador pasado de vigencia sigue pintando su fecha en los colores', async () => {
    const FECHA_VIEJA = '2029-05-20';
    const q = await createQuote(
      prisma,
      { fecha: FECHA_VIEJA, invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Vigencia Pasada' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);
    await prisma.quote.update({
      where: { id: q.id },
      data: { vigenciaHasta: new Date('2020-01-01T00:00:00.000Z') },
    });

    const dispo = await getAvailability(prisma, FECHA_VIEJA, [arcosId]);
    expect(dispo.spaces[0]!.level).toBe('cotizaciones');
    expect(dispo.spaces[0]!.counts.cotizaciones).toBe(1);
  });
});

describe('getAgenda sin el filtro de vencida', () => {
  it('devuelve el borrador viejo, y sigue devolviendo lo formalizado', async () => {
    const FECHA_AG = '2029-06-09';
    const borrador = await createQuote(
      prisma,
      { fecha: FECHA_AG, invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Agenda Borrador' } },
      actor,
    );
    created.push(borrador.id);
    createdClients.push(borrador.clientId);
    await prisma.quote.update({
      where: { id: borrador.id },
      data: { vigenciaHasta: new Date('2020-01-01T00:00:00.000Z') },
    });

    const { events } = await getAgenda(prisma, FECHA_AG, FECHA_AG);
    const mio = events.find((e) => e.quoteId === borrador.id);
    expect(mio).toBeDefined();
    expect(mio!.status).toBe('borrador');
  });

  it('la papelera sí se sigue excluyendo de la agenda', async () => {
    const FECHA_PAP = '2029-06-10';
    const q = await createQuote(
      prisma,
      { fecha: FECHA_PAP, invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Agenda Papelera' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);
    await prisma.quote.update({ where: { id: q.id }, data: { deletedAt: new Date() } });

    const { events } = await getAgenda(prisma, FECHA_PAP, FECHA_PAP);
    expect(events.some((e) => e.quoteId === q.id)).toBe(false);
  });
});
