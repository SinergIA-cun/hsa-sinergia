import { describe, expect, it } from 'vitest';
import { listaParaFecha, type CatalogoConAnio, type PeriodoLista } from './periodosLista.js';

const catalogos: CatalogoConAnio[] = [
  { id: 'c2027', anio: 2027 },
  { id: 'c2028', anio: 2028 },
  { id: 'bodas2028', anio: 2028 },
];

const p = (id: string, priceListId: string, desde: string, hasta: string): PeriodoLista => ({
  id,
  priceListId,
  desde,
  hasta,
});

describe('listaParaFecha', () => {
  it('sin fecha no propone nada', () => {
    expect(listaParaFecha('', [], catalogos)).toBeUndefined();
  });

  it('usa el periodo que contiene la fecha, con sus extremos incluidos', () => {
    const periodos = [p('a', 'c2027', '2027-01-01', '2027-12-31')];
    expect(listaParaFecha('2027-01-01', periodos, catalogos)).toMatchObject({ priceListId: 'c2027', motivo: 'periodo' });
    expect(listaParaFecha('2027-12-31', periodos, catalogos)).toMatchObject({ priceListId: 'c2027', motivo: 'periodo' });
  });

  it('el periodo más corto gana: un mes de temporada alta dentro del año', () => {
    const periodos = [
      p('anio', 'c2028', '2028-01-01', '2028-12-31'),
      p('dic', 'bodas2028', '2028-12-01', '2028-12-31'),
    ];
    expect(listaParaFecha('2028-12-15', periodos, catalogos)).toMatchObject({ priceListId: 'bodas2028', periodoId: 'dic' });
    expect(listaParaFecha('2028-06-15', periodos, catalogos)).toMatchObject({ priceListId: 'c2028', periodoId: 'anio' });
  });

  it('dos periodos del mismo largo con listas distintas son un conflicto, no una adivinanza', () => {
    const periodos = [
      p('x', 'c2028', '2028-03-01', '2028-03-31'),
      p('y', 'bodas2028', '2028-03-01', '2028-03-31'),
    ];
    expect(listaParaFecha('2028-03-10', periodos, catalogos)).toEqual({
      motivo: 'conflicto',
      priceListIds: ['c2028', 'bodas2028'],
    });
  });

  it('dos periodos iguales con la MISMA lista no son conflicto', () => {
    const periodos = [p('x', 'c2028', '2028-03-01', '2028-03-31'), p('y', 'c2028', '2028-03-01', '2028-03-31')];
    expect(listaParaFecha('2028-03-10', periodos, catalogos)).toMatchObject({ priceListId: 'c2028', motivo: 'periodo' });
  });

  it('sin periodo cae a la regla de siempre: el único catálogo del año', () => {
    expect(listaParaFecha('2027-05-05', [], catalogos)).toEqual({ priceListId: 'c2027', motivo: 'anio' });
  });

  it('sin periodo y con dos catálogos del año, no propone', () => {
    expect(listaParaFecha('2028-05-05', [], catalogos)).toBeUndefined();
  });

  it('ignora periodos de un catálogo que ya no existe', () => {
    const periodos = [p('x', 'borrado', '2027-01-01', '2027-12-31')];
    expect(listaParaFecha('2027-05-05', periodos, catalogos)).toEqual({ priceListId: 'c2027', motivo: 'anio' });
  });
});
