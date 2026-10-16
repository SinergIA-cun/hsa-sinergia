import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, updateQuote, seleccionGuardada, SELECCION_INCLUDE, type Actor } from './service.js';
import { productosDelEvento } from '../cargos/cuenta.js';

/** Hora extra en % de la renta o en monto fijo por hora, por evento (Fernando, 16-oct-2026). */

let admin: Actor;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];

beforeAll(async () => {
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
});

const base = (fecha: string) => ({
  fecha,
  invitados: 200,
  spaceIds: [] as string[],
  eventTypeId: '',
  client: { nombre: 'Hora Extra Prueba', tipo: 'persona' as const, telefono: '5512121212' },
});

const lineaHoras = (b: unknown) => (b as { lines: { concepto: string; monto: number; detalle?: string }[] }).lines.find((l) => l.concepto === 'Horas extra');

describe('hora extra: % o monto fijo', () => {
  it('se guarda el monto fijo, cobra eso por hora, sobrevive a editar y lo sugiere el punto de venta', async () => {
    const q = await createQuote(prisma, { ...base('2064-06-07'), spaceIds: [arcosId], eventTypeId: bodaId, horasExtra: 2, horaExtraMonto: 4_000 }, admin);
    quotes.push(q.id);
    expect(q).toMatchObject({ horaExtraMonto: 4_000, horaExtraPct: null });
    expect(lineaHoras(q.breakdown)).toMatchObject({ monto: 8_000, detalle: '2 × $4,000 por hora' });

    // Editar sin tocar la hora extra (p. ej. cambiar invitados) la conserva.
    const guardada = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: SELECCION_INCLUDE });
    const editada = await updateQuote(prisma, q.id, { ...seleccionGuardada(guardada), invitados: 210 }, admin);
    expect(lineaHoras(editada.breakdown)).toMatchObject({ monto: 8_000 });

    const productos = await productosDelEvento(prisma, editada);
    expect(productos.find((p) => p.producto === 'horaExtra')).toMatchObject({ precioSugerido: 4_000 });
  });

  it('en otro % del evento; sin nada, el del catálogo; los dos a la vez no', async () => {
    const pct = await createQuote(prisma, { ...base('2064-06-14'), spaceIds: [arcosId], eventTypeId: bodaId, horasExtra: 1, horaExtraPct: 10 }, admin);
    quotes.push(pct.id);
    const catalogo = await createQuote(prisma, { ...base('2064-06-21'), spaceIds: [arcosId], eventTypeId: bodaId, horasExtra: 1 }, admin);
    quotes.push(catalogo.id);
    expect(lineaHoras(pct.breakdown)!.monto).toBeCloseTo(lineaHoras(catalogo.breakdown)!.monto * 2, 2);
    expect(lineaHoras(pct.breakdown)!.detalle).toBe('1 × 10% renta');

    await expect(
      createQuote(prisma, { ...base('2064-06-28'), spaceIds: [arcosId], eventTypeId: bodaId, horasExtra: 1, horaExtraPct: 10, horaExtraMonto: 3_000 }, admin),
    ).rejects.toThrow();
  });
});
