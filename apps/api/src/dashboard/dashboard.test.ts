import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { createQuote, updateStatus, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { registrarDeposito } from '../banqueteros/cuenta.js';
import { crearApartado } from '../banqueteros/apartados.js';
import { getDashboard } from './service.js';

// Actor aislado (vendedora propia) para que el dashboard solo vea estas
// cotizaciones y las métricas sean deterministas sin depender del resto de la BD.
let actor: Actor;
let sellerId: string;
let arcosId: string;
let eventTypeId: string;
const created: string[] = [];
const createdClients: string[] = [];
const createdBanqueteros: string[] = [];
const storage = new ServerStorage(join(tmpdir(), 'hsa-dash-test-' + randomUUID()));
/** El admin: registrar un depósito es solo de admin. */
let adminActor: Actor;

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
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@haciendasanandres.com.mx' },
  });
  adminActor = { id: admin!.id, role: 'admin' };
});

afterAll(async () => {
  await prisma.apartadoFecha.deleteMany({ where: { banqueteroId: { in: createdBanqueteros } } });
  await prisma.pagoBanquetero.deleteMany({ where: { banqueteroId: { in: createdBanqueteros } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: created } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: created } } });
  await prisma.quote.deleteMany({ where: { id: { in: created } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClients } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: createdBanqueteros } } });
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

/**
 * Lo que el tablero grita y hoy es invisible (Task 5 del Plan H).
 *
 * Los números de banqueteros son GLOBALES a propósito (el saldo sin asignar es
 * dinero de la hacienda, no una cifra de ventas), así que estas pruebas buscan
 * SUS filas en la respuesta en vez de exigir totales exactos: la base de pruebas
 * la comparten varias suites.
 */
describe('getDashboard · lo que el tablero grita', () => {
  it('un evento pasado sin liquidar sale como alerta con nombre y fecha', async () => {
    // 40 días atrás: el evento ya pasó y nunca se pagó nada.
    const pasado = new Date();
    pasado.setUTCDate(pasado.getUTCDate() - 40);
    const iso = pasado.toISOString().slice(0, 10);

    const q = await createQuote(
      prisma,
      { fecha: iso, invitados: 180, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Dash Pasado' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);
    await updateStatus(prisma, q.id, 'formalizada', actor);

    const d = await getDashboard(prisma, actor);
    const mio = d.pasadosSinLiquidar.find((e) => e.quoteId === q.id);
    expect(mio).toBeDefined();
    expect(mio!.cliente).toBe('Dash Pasado');
    expect(mio!.restante).toBeGreaterThan(0);
    expect(mio!.diasDesdeEvento).toBe(40);
    // Sigue estando en `alertas` (el finiquito venció hace mucho). La interfaz es
    // la que evita listarlo dos veces; el API no oculta nada.
    expect(d.alertas.some((a) => a.quoteId === q.id)).toBe(true);
  });

  it('un borrador pasado NO cuenta como evento sin liquidar', async () => {
    const pasado = new Date();
    pasado.setUTCDate(pasado.getUTCDate() - 20);
    const q = await createQuote(
      prisma,
      {
        fecha: pasado.toISOString().slice(0, 10),
        invitados: 100,
        spaceIds: [arcosId],
        eventTypeId,
        client: { nombre: 'Dash Borrador Viejo' },
      },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);

    const d = await getDashboard(prisma, actor);
    // Un borrador no es un evento: nadie se paró en la hacienda ese día.
    expect(d.pasadosSinLiquidar.some((e) => e.quoteId === q.id)).toBe(false);
  });

  it('el saldo sin asignar de un banquetero aparece en el tablero', async () => {
    const b = await prisma.banquetero.create({
      data: { nombre: `Dash Banquetero ${randomUUID().slice(0, 6)}` },
    });
    createdBanqueteros.push(b.id);
    await registrarDeposito(
      prisma,
      storage,
      b.id,
      { monto: 158_345, metodo: 'transferencia', fecha: '2026-03-05' },
      adminActor,
    );

    const d = await getDashboard(prisma, actor);
    const fila = d.banqueteros.saldos.find((x) => x.banqueteroId === b.id);
    expect(fila).toBeDefined();
    expect(fila!.saldoSinAsignar).toBe(158_345);
    expect(d.banqueteros.totalSinAsignar).toBeGreaterThanOrEqual(158_345);
    // Ordenados de mayor a menor: el que más trae sin repartir va primero.
    const saldos = d.banqueteros.saldos.map((x) => x.saldoSinAsignar);
    expect([...saldos].sort((x, y) => y - x)).toEqual(saldos);
  });

  it('un apartado por vencer sale en la lista y en el conteo de 30 días', async () => {
    const b = await prisma.banquetero.create({
      data: { nombre: `Dash Apartador ${randomUUID().slice(0, 6)}` },
    });
    createdBanqueteros.push(b.id);

    const enDiez = new Date();
    enDiez.setUTCDate(enDiez.getUTCDate() + 10);
    const { apartado } = await crearApartado(
      prisma,
      b.id,
      {
        // Una fecha lejana para no chocar con los eventos de las otras suites.
        fechaEvento: '2038-06-05',
        spaceIds: [arcosId],
        vence: enDiez.toISOString().slice(0, 10),
        deposito: 20_000,
        depositoMetodo: 'transferencia',
        depositoFecha: new Date().toISOString().slice(0, 10),
        confirmar: true,
      },
      adminActor,
    );

    const d = await getDashboard(prisma, actor);
    const mio = d.banqueteros.apartados.find((a) => a.apartadoId === apartado.id);
    expect(mio).toBeDefined();
    expect(mio!.banqueteroId).toBe(b.id);
    expect(mio!.diasParaVencer).toBeLessThanOrEqual(10);
    expect(mio!.deposito).toBe(20_000);
    expect(d.banqueteros.porVencer).toBeGreaterThanOrEqual(1);
  });
});
