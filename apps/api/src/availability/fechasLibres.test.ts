import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, type Actor } from '../quotes/service.js';
import { fechasLibres } from './service.js';
import { crearApartado, diasConLugar, fijarTope } from '../apartadosRapidos/service.js';

/** Sugerir fechas libres (reunión del 15-oct-2026). */

let admin: Actor;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];
const SAB = '2069-06-15'; // un sábado
const masSemanas = (iso: string, k: number) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + k * 7 * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await prisma.apartadoRapido.deleteMany({ where: { fecha: { gte: new Date('2069-01-01'), lt: new Date('2070-01-01') } } });
  await fijarTope(prisma, { tope: 10 }, admin);
});

async function formal(fecha: string) {
  const q = await createQuote(prisma, { fecha, invitados: 150, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Libres', telefono: '5513131313' } }, admin);
  quotes.push(q.id);
  await prisma.quote.update({ where: { id: q.id }, data: { status: 'formalizada' } });
}

describe('fechas libres', () => {
  it('propone el mismo día de la semana, saltando las ocupadas, las más cercanas primero', async () => {
    await formal(SAB);
    await formal(masSemanas(SAB, 1));
    const libres = await fechasLibres(prisma, SAB, [arcosId], { cuantas: 3, hoy: new Date('2069-01-01T00:00:00.000Z') });
    expect(libres).toEqual([masSemanas(SAB, -2), masSemanas(SAB, -1), masSemanas(SAB, 2)]);
    expect(libres.every((f) => new Date(`${f}T00:00:00.000Z`).getUTCDay() === 6)).toBe(true);
  });

  it('en apartados, propone días con lugar en la fila', async () => {
    await fijarTope(prisma, { tope: 5 }, admin);
    const dia = masSemanas(SAB, 4);
    for (let i = 0; i < 5; i++) {
      await crearApartado(prisma, { nombre: `Fila ${i}`, eventTypeId: bodaId, fecha: dia }, admin);
    }
    const dias = await diasConLugar(prisma, dia, 3, new Date('2069-01-01T00:00:00.000Z'));
    expect(dias.map((d) => d.fecha)).not.toContain(dia);
    expect(dias.length).toBe(3);
  });
});
