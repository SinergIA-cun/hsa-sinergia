import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, updateQuote, seleccionGuardada, SELECCION_INCLUDE, type Actor } from '../quotes/service.js';

/** Cliente o empresa (16-oct-2026): se guarda en la ficha del cliente y llega al BI. */

const LLAVE = 'e'.repeat(64);
let app: FastifyInstance;
let admin: Actor;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE } });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.codigoEvento.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await app.close();
});

describe('cliente o empresa', () => {
  it('se guarda al crear y al editar, y el BI lo recibe en el cliente del evento', async () => {
    const q = await createQuote(
      prisma,
      { fecha: '2061-03-05', invitados: 150, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Tipo Cliente SA', tipo: 'empresa', telefono: '5518181818' } },
      admin,
    );
    quotes.push(q.id);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: q.clientId } })).tipo).toBe('empresa');

    const bi = async () => {
      const r = await app.inject({ method: 'GET', url: `/api/bi/eventos?ids=${q.id}`, headers: { 'x-api-key': LLAVE } });
      return r.json().datos[0].cliente;
    };
    expect(await bi()).toMatchObject({ nombre: 'Tipo Cliente SA', tipo: 'empresa' });

    const guardada = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: SELECCION_INCLUDE });
    // Sin la llave, se queda como estaba.
    await updateQuote(prisma, q.id, { ...seleccionGuardada(guardada), client: { nombre: 'Tipo Cliente SA', telefono: '5518181818' } }, admin);
    expect(await bi()).toMatchObject({ tipo: 'empresa' });
    await updateQuote(prisma, q.id, { ...seleccionGuardada(guardada), client: { nombre: 'Tipo Cliente SA', tipo: 'persona', telefono: '5518181818' } }, admin);
    expect(await bi()).toMatchObject({ tipo: 'persona' });
  });

  it('un tipo inventado no pasa', async () => {
    await expect(
      createQuote(
        prisma,
        { fecha: '2061-03-12', invitados: 150, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Tipo Raro', tipo: 'otro' as never, telefono: '5518181819' } },
        admin,
      ),
    ).rejects.toThrow();
  });
});
