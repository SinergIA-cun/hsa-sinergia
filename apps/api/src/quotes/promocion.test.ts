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

describe('descuento en monto fijo', () => {
  // "El descuento queremos que pueda ser % o monto fijo" (el dueño, 5-oct-2026).
  it('resta el monto de la renta, se conserva al mover y al duplicar, y el BI lo ve como monto', async () => {
    const sin = await evento();
    const con = await evento({ esPromocion: true, descuentoMonto: 7_500, descuentoMotivo: 'Cliente frecuente' });
    expect(con.descuentoMonto).toBe(7_500);
    expect(con.descuentoPct).toBeNull();
    expect(con.rentaTotal).toBe(sin.rentaTotal - 7_500);

    const movido = await moveQuoteDate(prisma, con.id, sabado(), admin);
    expect(movido.descuentoMonto).toBe(7_500);
    const copia = await duplicateQuote(prisma, con.id, admin);
    quotes.push(copia.id);
    expect(copia.descuentoMonto).toBe(7_500);

    const dia = movido.fechaEvento.toISOString().slice(0, 10);
    const ev = (await biEventos(prisma, { desde: new Date(`${dia}T00:00:00Z`), hasta: new Date(`${dia}T23:59:59Z`), limit: 500 })).find((e) => e.id === con.id);
    expect(ev?.descuento).toEqual({ porcentaje: null, monto: 7_500, motivo: 'Cliente frecuente' });
  });

  it('porcentaje y monto a la vez se rechazan; monto sin motivo también', async () => {
    await expect(evento({ descuentoPct: 10, descuentoMonto: 5_000, descuentoMotivo: 'Doble' })).rejects.toThrow(/porcentaje o en monto/);
    await expect(evento({ esPromocion: true, descuentoMonto: 5_000 })).rejects.toThrow(/requiere motivo/);
  });
});
