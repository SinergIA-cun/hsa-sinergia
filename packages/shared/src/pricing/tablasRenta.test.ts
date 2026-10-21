import { describe, it, expect } from 'vitest';
import type { Catalog, RentalPriceRow } from '../types.js';
import { MENSAJE_SIN_TABLA, tablaDeRenta } from './tablasRenta.js';

const fila = (precio: number): RentalPriceRow => ({ spaceId: 's1', min: 1, max: null, prices: { sabado: precio } });
const base = {
  rentalPrices: [fila(1)],
  rentalPricesFlat: [fila(2)],
  flatRentalEventTypeIds: ['tb'],
} as unknown as Catalog;

describe('tablaDeRenta (21-oct-2026)', () => {
  it('sin tablas, la de siempre o la plana', () => {
    expect(tablaDeRenta(base, 'boda').rows).toBe(base.rentalPrices);
    expect(tablaDeRenta(base, 'tb').rows).toBe(base.rentalPricesFlat);
  });

  it('con tablas, la que tiene elegido el tipo; sin tipo, la primera', () => {
    const cat = {
      ...base,
      tablasRenta: [
        { clave: 'dia', nombre: 'Renta', eventTypeIds: ['boda'], rows: [fila(10)] },
        { clave: 'grad', nombre: 'Graduaciones', eventTypeIds: ['grad'], rows: [fila(20)] },
      ],
    } as Catalog;
    expect(tablaDeRenta(cat, 'grad')).toMatchObject({ nombre: 'Graduaciones', rows: [fila(20)] });
    expect(tablaDeRenta(cat, null).rows).toEqual([fila(10)]);
    expect(() => tablaDeRenta(cat, 'xv')).toThrow(MENSAJE_SIN_TABLA);
  });
});
