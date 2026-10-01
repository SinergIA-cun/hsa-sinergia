import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, duplicateQuote, moveQuoteDate, type Actor } from './service.js';
import { biEventos } from '../bi/service.js';

/**
 * "Otro campo como el de cortesía familiar, de descuento/promoción, que funcione
 * igual pero sin marcar colores. Solo afecta la renta del local" (el dueño).
 */

let admin: Actor;
let arcosId: string;
let eventTypeId: string;
const quotes: string[] = [];
const clients: string[] = [];

let semana = 0;
const sabado = () => new Date(Date.UTC(2053, 0, 4 + 7 * semana++)).toISOString().slice(0, 10);

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
});

const evento = async (extra: Record<string, unknown> = {}) => {
  const q = await createQuote(
    prisma,
    { fecha: sabado(), invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Promo Test', telefono: '5512345678' }, ...extra },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
};

describe('descuento / promoción', () => {
  it('descuenta la renta, no es cortesía y el renglón lo dice', async () => {
    const sin = await evento();
    const con = await evento({ esPromocion: true, descuentoPct: 25, descuentoMotivo: 'Promo de octubre' });
    expect(con.esPromocion).toBe(true);
    expect(con.esCortesia).toBe(false);
    expect(con.rentaTotal).toBe(Math.round(sin.rentaTotal * 0.75));
    const lineas = (con.breakdown as { lines: { concepto: string }[] }).lines;
    expect(lineas.some((l) => l.concepto === 'Descuento / promoción (25% renta)')).toBe(true);
  });

  it('se conserva al mover la fecha y al duplicar', async () => {
    const q = await evento({ esPromocion: true, descuentoPct: 5, descuentoMotivo: 'Cliente frecuente' });
    const movido = await moveQuoteDate(prisma, q.id, sabado(), admin);
    expect(movido.esPromocion).toBe(true);
    expect(movido.descuentoPct).toBe(5);
    const copia = await duplicateQuote(prisma, q.id, admin);
    quotes.push(copia.id);
    expect(copia.esPromocion).toBe(true);
    expect(copia.descuentoPct).toBe(5);
  });

  it('el BI recibe si es promoción, con su porcentaje y motivo', async () => {
    const q = await evento({ esPromocion: true, descuentoPct: 10, descuentoMotivo: 'Promo' });
    const fila = (await biEventos(prisma, { desde: q.fechaEvento, hasta: q.fechaEvento, limit: 500 })).find((f) => f.id === q.id)!;
    expect(fila).toMatchObject({ esPromocion: true, esCortesia: false, descuento: { porcentaje: 10, motivo: 'Promo' } });
  });
});
