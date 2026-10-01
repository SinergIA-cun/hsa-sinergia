import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import {
  createQuote,
  duplicateQuote,
  getQuote,
  listQuotes,
  moveQuoteDate,
  updateQuote,
  updateStatus,
  seleccionGuardada,
  type Actor,
} from './service.js';
import { eventoPorCodigo } from './codigo.js';
import { biEventos } from '../bi/service.js';
import { importarLote, type EventoBI } from '../bi/importar.js';

/**
 * "Debe ser el código PRINCIPAL, pero que si se cambia la fecha o el salón, se
 * cambie y se guarden los cambios que se fueron realizando. Esto mismo se debe
 * mandar con el BI" (el dueño, 1-oct-2026).
 */

let admin: Actor;
let arcosId: string;
let cupulaId: string;
let eventTypeId: string;
const quotes: string[] = [];
const clients: string[] = [];
const idsBI: string[] = [];

let semana = 0;
const sabado = () => new Date(Date.UTC(2049, 0, 2 + 7 * semana++)).toISOString().slice(0, 10);

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  cupulaId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Cúpula' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  const importados = await prisma.quote.findMany({ where: { importadoBI: { in: idsBI } }, select: { id: true, clientId: true } });
  const ids = [...quotes, ...importados.map((q) => q.id)];
  await prisma.payment.deleteMany({ where: { quoteId: { in: ids } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: ids } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: ids } } });
  await prisma.quote.deleteMany({ where: { id: { in: ids } } });
  await prisma.client.deleteMany({ where: { id: { in: [...clients, ...importados.map((q) => q.clientId)] } } });
});

async function crear(nombre: string, fecha = sabado()) {
  const q = await createQuote(
    prisma,
    { fecha, invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre, telefono: '5512345678' } },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

async function seleccion(id: string) {
  const q = await prisma.quote.findUniqueOrThrow({ where: { id }, include: { extras: true } });
  return seleccionGuardada(q);
}

const historial = (quoteId: string) =>
  prisma.codigoEvento.findMany({ where: { quoteId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

describe('el código del evento', () => {
  it('nace con su código y el primer renglón del historial', async () => {
    const q = await crear('Hugo Langruen');
    expect(q.etiqueta).toMatch(/^\d{2}[A-Z]{3}49-HLANGRUEN-ARCOS$/);
    const h = await historial(q.id);
    expect(h.map((x) => [x.codigo, x.motivos])).toEqual([[q.etiqueta, ['alta']]]);
  });

  it('cambia al mover la fecha, aunque ya esté formalizado, y guarda el rastro; el folio no se mueve', async () => {
    const q = await crear('Hugo Langruen');
    await updateStatus(prisma, q.id, 'formalizada', admin);
    const nueva = sabado();
    const movido = await moveQuoteDate(prisma, q.id, nueva, admin);
    expect(movido.etiqueta).not.toBe(q.etiqueta);
    expect(movido.etiqueta!.startsWith(`${nueva.slice(8, 10)}`)).toBe(true);
    expect(movido.folio).toBe(q.folio);
    const h = await historial(q.id);
    expect(h.map((x) => x.codigo)).toEqual([q.etiqueta, movido.etiqueta]);
    expect(h[1]!.motivos).toEqual(['fecha']);
    expect(h[1]!.actorId).toBe(admin.id);
  });

  it('cambia al cambiar de salón', async () => {
    const q = await crear('Hugo Langruen');
    const sel = await seleccion(q.id);
    const u = await updateQuote(prisma, q.id, { ...sel, spaceIds: [cupulaId] }, admin);
    expect(u.etiqueta).toMatch(/-HLANGRUEN-CUPULA$/);
    expect((await historial(q.id))[1]!.motivos).toEqual(['espacio']);
  });

  it('guardar sin cambiar nada no mueve el código ni escribe historial', async () => {
    const q = await crear('Hugo Langruen');
    await updateQuote(prisma, q.id, await seleccion(q.id), admin);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).etiqueta).toBe(q.etiqueta);
    expect(await historial(q.id)).toHaveLength(1);
  });

  it('dos eventos vivos no comparten código: la copia lleva sufijo y lo conserva al guardarse', async () => {
    const q = await crear('Hugo Langruen');
    const copia = await duplicateQuote(prisma, q.id, admin);
    quotes.push(copia.id);
    expect(copia.etiqueta).toBe(`${q.etiqueta}-2`);
    await updateQuote(prisma, copia.id, await seleccion(copia.id), admin);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: copia.id } })).etiqueta).toBe(`${q.etiqueta}-2`);
    // Y la tercera, -3.
    const otra = await duplicateQuote(prisma, q.id, admin);
    quotes.push(otra.id);
    expect(otra.etiqueta).toBe(`${q.etiqueta}-3`);
  });

  it('el código viejo de un recibo sigue llevando al evento, también en el buscador', async () => {
    const q = await crear('Hugo Langruen');
    const movido = await moveQuoteDate(prisma, q.id, sabado(), admin);
    expect(await eventoPorCodigo(prisma, q.etiqueta!)).toBe(q.id);
    expect(await eventoPorCodigo(prisma, movido.etiqueta!)).toBe(q.id);
    const fila = (await listQuotes(prisma, admin)).find((x) => x.id === q.id)!;
    expect(fila.codigosAnteriores).toEqual([q.etiqueta]);
    const detalle = await getQuote(prisma, q.id, admin);
    expect(detalle!.codigos.map((c) => c.codigo)).toEqual([q.etiqueta, movido.etiqueta]);
  });
});

describe('el código en el BI', () => {
  it('/eventos manda el código vigente y todos los anteriores', async () => {
    const q = await crear('Hugo Langruen');
    const nueva = sabado();
    const movido = await moveQuoteDate(prisma, q.id, nueva, admin);
    const dia = new Date(`${nueva}T00:00:00.000Z`);
    const filas = await biEventos(prisma, { desde: dia, hasta: dia, limit: 500 });
    const mia = filas.find((f) => f.id === q.id)!;
    expect(mia.codigo).toBe(movido.etiqueta);
    expect(mia.codigos.map((c) => c.codigo)).toEqual([q.etiqueta, movido.etiqueta]);
    expect(mia.codigos[1]!.motivos).toEqual(['fecha']);
  });

  const eventoBI = (over: Partial<EventoBI>): EventoBI => {
    const idBI = `BI-cod-${randomUUID().slice(0, 8)}`;
    idsBI.push(idBI);
    return {
      idBI,
      fechaContratacion: '2026-02-02',
      fechaEvento: sabado(),
      tipoEvento: 'Boda',
      salones: ['Arcos'],
      invitados: 220,
      cliente: { nombre: 'Del BI Con Código', telefono: `55${Math.floor(Math.random() * 1e8)}` },
      renta: { total: 95_000 },
      pagos: [],
      ...over,
    };
  };

  it('un evento importado con el código que ya usa la operación nace con ese código', async () => {
    const ev = eventoBI({ codigo: 'CODIGO-DE-PAPEL-1' });
    const r = await importarLote(prisma, { eventos: [ev] });
    expect(r.resultados[0]).toMatchObject({ accion: 'creado', codigoHSA: 'CODIGO-DE-PAPEL-1' });
    const q = await prisma.quote.findUniqueOrThrow({ where: { importadoBI: ev.idBI } });
    expect(await historial(q.id)).toHaveLength(1);
  });

  it('el BI liga por código, incluso por uno que el evento ya no tiene', async () => {
    const q = await crear('Hugo Langruen');
    const movido = await moveQuoteDate(prisma, q.id, sabado(), admin);
    const ev = eventoBI({
      codigo: q.etiqueta!,
      fechaEvento: movido.fechaEvento.toISOString().slice(0, 10),
    });
    const r = await importarLote(prisma, { eventos: [ev] });
    expect(r.resultados[0]).toMatchObject({ accion: 'ligado', quoteId: q.id, codigoHSA: movido.etiqueta });
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).importadoBI).toBe(ev.idBI);
  });
});
