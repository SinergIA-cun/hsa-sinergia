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
  it('solo eventos (no pipeline); la apartada de esta semana aparece como ficha', async () => {
    // Estado inicial: sin datos propios.
    const vacio = await getDashboard(prisma, actor);
    expect(vacio.kpis.eventosMes).toBe(0);
    expect(vacio.fichasSemana).toHaveLength(0);
    expect(vacio.proximaSemana).toHaveLength(0);
    expect(vacio.alertas).toHaveLength(0);

    // Borrador HOY → NO es evento; no aparece en el panel operativo.
    const borrador = await createQuote(
      prisma,
      { fecha: HOY, invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Dash Borrador' } },
      actor,
    );
    created.push(borrador.id);
    createdClients.push(borrador.clientId);

    const conBorrador = await getDashboard(prisma, actor);
    expect(conBorrador.kpis.eventosMes).toBe(0);
    expect(conBorrador.fichasSemana).toHaveLength(0);

    // Apartada HOY → evento del mes y ficha de la semana; sin hoja operativa ⇒ semáforo rojo.
    const apartada = await createQuote(
      prisma,
      { fecha: HOY, invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Dash Apartada' } },
      actor,
    );
    created.push(apartada.id);
    createdClients.push(apartada.clientId);
    await updateStatus(prisma, apartada.id, 'formalizada', actor);

    const final = await getDashboard(prisma, actor);
    expect(final.kpis.eventosMes).toBe(1);
    expect(final.fichasSemana).toHaveLength(1);
    expect(final.fichasSemana[0]!.cliente).toBe('Dash Apartada');
    expect(final.fichasSemana[0]!.semaforo).toBe('rojo');

    // La ficha trae el estado de finiquito (evento esta semana, sin pagar ⇒ pendiente).
    expect(final.fichasSemana[0]!.finiquito.pendiente).toBe(true);
    expect(final.fichasSemana[0]!.invitados).toBe(250);

    // Y genera alerta de finiquito (apartada + ya en su ventana de 30 días, sin pagar).
    expect(final.alertas).toHaveLength(1);
    expect(final.alertas[0]!.cliente).toBe('Dash Apartada');
    expect(final.alertas[0]!.restante).toBeGreaterThan(0);
  });
});
