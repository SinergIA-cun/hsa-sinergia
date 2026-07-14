import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, updateStatus, type Actor } from '../quotes/service.js';
import { getAvailability } from './service.js';

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
  it('escala el nivel: libre → cotizaciones → apartada → bloqueada, y excluye la propia', async () => {
    // Libre inicialmente
    const libre = await getAvailability(prisma, FECHA, [arcosId]);
    expect(libre.spaces[0]!.level).toBe('libre');

    // Una cotización borrador
    const q = await createQuote(
      prisma,
      { fecha: FECHA, invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Dispo Test' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);

    expect((await getAvailability(prisma, FECHA, [arcosId])).spaces[0]!.level).toBe('cotizaciones');

    await updateStatus(prisma, q.id, 'apartada', actor);
    expect((await getAvailability(prisma, FECHA, [arcosId])).spaces[0]!.level).toBe('apartada');

    await updateStatus(prisma, q.id, 'formalizada', actor);
    const bloq = await getAvailability(prisma, FECHA, [arcosId]);
    expect(bloq.spaces[0]!.level).toBe('bloqueada');
    expect(bloq.blocked).toBe(true);

    // Excluyendo la propia cotización, vuelve a libre (para no bloquearse al editar)
    const excl = await getAvailability(prisma, FECHA, [arcosId], q.id);
    expect(excl.blocked).toBe(false);
    expect(excl.spaces[0]!.level).toBe('libre');
  });

  it('capillaOcupada: se marca cuando otro evento usa la capilla ese día', async () => {
    const FECHA_CAP = '2029-04-15';
    expect((await getAvailability(prisma, FECHA_CAP, [arcosId])).capillaOcupada).toBe(false);

    const q = await createQuote(
      prisma,
      { fecha: FECHA_CAP, invitados: 200, spaceIds: [arcosId], eventTypeId, usaCapilla: true, client: { nombre: 'Capilla Test' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);

    expect((await getAvailability(prisma, FECHA_CAP, [arcosId])).capillaOcupada).toBe(true);
    // Excluyendo la propia, vuelve libre (para poder editarla sin auto-bloquearse).
    expect((await getAvailability(prisma, FECHA_CAP, [arcosId], q.id)).capillaOcupada).toBe(false);
  });
});
