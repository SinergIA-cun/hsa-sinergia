import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@hsa/database';
import { listaParaFecha } from '@hsa/shared';
import { QuoteError } from '../quotes/service.js';
import { borrarPeriodo, crearPeriodo, listarPeriodos } from './periodos.js';

/** Periodos de fechas ↔ lista (24-nov-2026). Año 2091 para no chocar con datos reales. */

const NOMBRES = ['Precios 2091 prueba-periodos', 'Temporada 2091 prueba-periodos'];
let general = '';
let temporada = '';

beforeAll(async () => {
  general = (await prisma.priceList.create({ data: { nombre: NOMBRES[0]!, anio: 2091 } })).id;
  temporada = (await prisma.priceList.create({ data: { nombre: NOMBRES[1]!, anio: 2091 } })).id;
});

afterAll(async () => {
  const ids = [general, temporada].filter(Boolean);
  await prisma.priceListAudit.deleteMany({ where: { priceListId: { in: ids } } });
  // Los periodos se van en cascada con la lista.
  await prisma.priceList.deleteMany({ where: { id: { in: ids } } });
});

const deEstaPrueba = async () => (await listarPeriodos(prisma)).filter((p) => [general, temporada].includes(p.priceListId));

describe('periodos de lista', () => {
  it('guarda el año completo y un mes de temporada dentro; la fecha escoge el más corto', async () => {
    await crearPeriodo(prisma, { priceListId: general, desde: '2091-01-01', hasta: '2091-12-31' }, null);
    await crearPeriodo(prisma, { priceListId: temporada, desde: '2091-12-01', hasta: '2091-12-31', nota: 'Diciembre' }, null);
    const periodos = await deEstaPrueba();
    const catalogos = [{ id: general, anio: 2091 }, { id: temporada, anio: 2091 }];
    expect(listaParaFecha('2091-12-24', periodos, catalogos)).toMatchObject({ priceListId: temporada });
    expect(listaParaFecha('2091-07-01', periodos, catalogos)).toMatchObject({ priceListId: general });
  });

  it('las fechas regresan tal cual, sin corrimiento de zona horaria', async () => {
    const dic = (await deEstaPrueba()).find((p) => p.nota === 'Diciembre');
    expect(dic).toMatchObject({ desde: '2091-12-01', hasta: '2091-12-31' });
  });

  it('rechaza un periodo del mismo largo que se empalma con otra lista', async () => {
    await expect(
      crearPeriodo(prisma, { priceListId: general, desde: '2091-12-01', hasta: '2091-12-31' }, null),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rechaza fechas al revés o inválidas', async () => {
    await expect(crearPeriodo(prisma, { priceListId: general, desde: '2091-05-10', hasta: '2091-05-01' }, null)).rejects.toThrow();
    await expect(crearPeriodo(prisma, { priceListId: general, desde: '2091-02-30', hasta: '2091-03-01' }, null)).rejects.toThrow();
  });

  it('rechaza una lista que no existe', async () => {
    await expect(
      crearPeriodo(prisma, { priceListId: 'no-existe', desde: '2091-01-01', hasta: '2091-01-31' }, null),
    ).rejects.toBeInstanceOf(QuoteError);
  });

  it('borrar deja rastro en la bitácora del catálogo', async () => {
    const dic = (await deEstaPrueba()).find((p) => p.nota === 'Diciembre')!;
    await borrarPeriodo(prisma, dic.id, null);
    expect((await deEstaPrueba()).some((p) => p.id === dic.id)).toBe(false);
    const rastro = await prisma.priceListAudit.findMany({ where: { priceListId: temporada, tipo: 'periodo' } });
    expect(rastro.map((r) => r.descripcion)).toEqual(
      expect.arrayContaining([expect.stringContaining('Agregó'), expect.stringContaining('Quitó')]),
    );
  });
});
