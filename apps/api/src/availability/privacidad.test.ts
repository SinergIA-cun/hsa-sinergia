import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, type Actor } from '../quotes/service.js';
import { getAgenda, getAvailability } from './service.js';
import { crearApartado, listarApartados } from '../apartadosRapidos/service.js';

/**
 * Privacidad entre vendedores (reunión del 15-oct-2026): de un evento ajeno, un
 * vendedor solo ve que el salón está ocupado. El admin ve todo.
 */

let admin: Actor;
let ventas: Actor;
let otraVentas: Actor;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];
const FECHA = '2063-03-10';

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const mk = async (email: string) =>
    (await prisma.user.upsert({ where: { email }, create: { email, nombre: email, passwordHash: 'x', role: 'ventas' }, update: {} })).id;
  ventas = { id: await mk('ventas-privacidad-a@test.local'), role: 'ventas' };
  otraVentas = { id: await mk('ventas-privacidad-b@test.local'), role: 'ventas' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await prisma.apartadoRapido.deleteMany({ where: { fecha: new Date(`${FECHA}T00:00:00.000Z`) } });
  await prisma.user.deleteMany({ where: { email: { in: ['ventas-privacidad-a@test.local', 'ventas-privacidad-b@test.local'] } } });
});

describe('un vendedor no ve los datos de eventos ajenos', () => {
  it('en la agenda y en la disponibilidad solo ve "Ocupado"; el suyo y el admin, todo', async () => {
    const ajeno = await createQuote(prisma, { fecha: FECHA, invitados: 150, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Cliente Secreto', telefono: '5519191919' } }, otraVentas);
    quotes.push(ajeno.id);

    const suAgenda = await getAgenda(prisma, FECHA, FECHA, { actor: ventas });
    expect(suAgenda.events.find((e) => e.quoteId === ajeno.id)).toMatchObject({ cliente: 'Ocupado', eventoNombre: 'Ocupado', ajeno: true });
    const delDueno = await getAgenda(prisma, FECHA, FECHA, { actor: otraVentas });
    expect(delDueno.events.find((e) => e.quoteId === ajeno.id)).toMatchObject({ cliente: 'Cliente Secreto' });
    const delAdmin = await getAgenda(prisma, FECHA, FECHA, { actor: admin });
    expect(delAdmin.events.find((e) => e.quoteId === ajeno.id)).toMatchObject({ cliente: 'Cliente Secreto' });

    const disp = await getAvailability(prisma, FECHA, [arcosId], undefined, { actor: ventas });
    expect(disp.spaces[0]!.quotes.find((q) => q.id === ajeno.id)?.cliente).toBe('Ocupado');
  });

  it('en la fila de apartados, el prospecto ajeno sale como "Reservado" y sin teléfono', async () => {
    await crearApartado(prisma, { nombre: 'Prospecto Secreto', telefono: '5518181818', eventTypeId: bodaId, fecha: FECHA }, otraVentas);
    const vista = await listarApartados(prisma, FECHA, FECHA, ventas);
    expect(vista.apartados[0]).toMatchObject({ nombre: 'Reservado', telefono: null, puedeGestionar: false });
    const delAdmin = await listarApartados(prisma, FECHA, FECHA, admin);
    expect(delAdmin.apartados[0]).toMatchObject({ nombre: 'Prospecto Secreto' });
    const disp = await getAvailability(prisma, FECHA, [arcosId], undefined, { actor: ventas });
    expect(disp.filaEspera).toEqual({ total: 1, primero: null });
  });
});
