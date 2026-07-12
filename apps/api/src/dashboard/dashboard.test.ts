import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, updateStatus, type Actor } from '../quotes/service.js';
import { getDashboard } from './service.js';

// Actor aislado (vendedora propia) para que el dashboard solo vea estas
// cotizaciones y las métricas sean deterministas sin depender del resto de la BD.
let actor: Actor;
let sellerId: string;
let arcosId: string;
let eventTypeId: string;
const created: string[] = [];
const createdClients: string[] = [];

const HOY = new Date().toISOString().slice(0, 10); // dentro del mes en curso y >= hoy

beforeAll(async () => {
  const arcos = await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } });
  const boda = await prisma.eventType.findFirst({ where: { slug: 'boda' } });
  arcosId = arcos!.id;
  eventTypeId = boda!.id;

  const seller = await prisma.user.create({
    data: {
      nombre: 'Dashboard Test Seller',
      email: `dash-test-${Date.now()}@haciendasanandres.com.mx`,
      passwordHash: 'x',
      role: 'ventas',
    },
  });
  sellerId = seller.id;
  actor = { id: seller.id, role: 'ventas' };
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: created } } });
  await prisma.quote.deleteMany({ where: { id: { in: created } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClients } } });
  await prisma.user.delete({ where: { id: sellerId } });
});

describe('getDashboard', () => {
  it('cuenta pipeline y eventos del mes solo del actor, y ordena próximos eventos', async () => {
    // Estado inicial: sin datos propios.
    const vacio = await getDashboard(prisma, actor);
    expect(vacio.kpis.cotizacionesActivas).toBe(0);
    expect(vacio.kpis.eventosMes).toBe(0);
    expect(vacio.proximosEventos).toHaveLength(0);

    // Una cotización en borrador → cuenta como pipeline, no como evento.
    const borrador = await createQuote(
      prisma,
      { fecha: HOY, invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Dash Borrador' } },
      actor,
    );
    created.push(borrador.id);
    createdClients.push(borrador.clientId);

    const conPipeline = await getDashboard(prisma, actor);
    expect(conPipeline.kpis.cotizacionesActivas).toBe(1);
    expect(conPipeline.kpis.eventosMes).toBe(0);

    // Una segunda cotización, apartada → cuenta como evento del mes y aparece en próximos.
    const apartada = await createQuote(
      prisma,
      { fecha: HOY, invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Dash Apartada' } },
      actor,
    );
    created.push(apartada.id);
    createdClients.push(apartada.clientId);
    await updateStatus(prisma, apartada.id, 'apartada', actor);

    const final = await getDashboard(prisma, actor);
    expect(final.kpis.cotizacionesActivas).toBe(1); // el borrador sigue; la apartada ya no es pipeline
    expect(final.kpis.eventosMes).toBe(1);
    expect(final.proximosEventos).toHaveLength(1);
    expect(final.proximosEventos[0]!.cliente).toBe('Dash Apartada');
    expect(final.proximosEventos[0]!.status).toBe('apartada');
  });
});
