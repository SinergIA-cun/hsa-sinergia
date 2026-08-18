import { describe, it, expect } from 'vitest';
import { findBracket, validarBrackets } from './brackets.js';
import type { CapacityBracket } from '../types.js';

const rows: (CapacityBracket & { v: number })[] = [
  { min: 1, max: 50, v: 42000 },
  { min: 51, max: 100, v: 76000 },
  { min: 201, max: 300, v: 108500 },
];

describe('findBracket', () => {
  it('encuentra el rango que contiene el número de invitados', () => {
    expect(findBracket(rows, 30)?.v).toBe(42000);
    expect(findBracket(rows, 100)?.v).toBe(76000);
    expect(findBracket(rows, 250)?.v).toBe(108500);
  });
  it('devuelve undefined si ningún rango aplica', () => {
    expect(findBracket(rows, 500)).toBeUndefined();
  });
  it('respeta max=null como sin tope', () => {
    expect(findBracket([{ min: 301, max: null, v: 679 }], 800)?.v).toBe(679);
  });
  it('incluye la frontera min del rango', () => {
    expect(findBracket(rows, 51)?.v).toBe(76000);
    expect(findBracket(rows, 201)?.v).toBe(108500);
  });
});

describe('validarBrackets', () => {
  const ok = (bs: CapacityBracket[]) => validarBrackets(bs);

  it('acepta una escalera contigua que termina abierta', () => {
    expect(ok([{ min: 1, max: 50 }, { min: 51, max: 100 }, { min: 101, max: null }])).toEqual([]);
  });

  it('acepta un solo rango', () => {
    expect(ok([{ min: 1, max: null }])).toEqual([]);
    expect(ok([{ min: 50, max: 100 }])).toEqual([]);
  });

  it('exige al menos un rango', () => {
    // Un paquete sin brackets es un paquete SIN PRECIO: el motor lanza
    // "no tiene rango para N invitados" la primera vez que alguien lo use.
    expect(ok([])).toHaveLength(1);
  });

  it('rechaza un traslape', () => {
    expect(ok([{ min: 50, max: 100 }, { min: 90, max: 200 }])).toHaveLength(1);
  });

  it('rechaza un hueco', () => {
    // 101–149 quedaría sin precio, y eso revienta meses después, cuando alguien
    // capture ese número de invitados.
    expect(ok([{ min: 50, max: 100 }, { min: 150, max: 200 }])).toHaveLength(1);
  });

  it('rechaza max menor que min', () => {
    expect(ok([{ min: 100, max: 50 }])).toHaveLength(1);
  });

  it('rechaza min menor que 1 o no entero', () => {
    expect(ok([{ min: 0, max: 50 }])).toHaveLength(1);
    expect(ok([{ min: 1.5, max: 50 }])).toHaveLength(1);
    expect(ok([{ min: 1, max: 50.5 }])).toHaveLength(1);
  });

  it('rechaza un rango abierto que no sea el último', () => {
    // Con max=null en medio, todo lo que viene después es inalcanzable:
    // `findBracket` devuelve el primero que contiene al invitado.
    expect(ok([{ min: 1, max: null }, { min: 101, max: 200 }])).toHaveLength(1);
  });

  it('no le importa el orden en que llegan', () => {
    expect(ok([{ min: 51, max: 100 }, { min: 1, max: 50 }])).toEqual([]);
  });

  it('acumula todos los problemas, no solo el primero', () => {
    expect(ok([{ min: 0, max: 50 }, { min: 200, max: 100 }]).length).toBeGreaterThan(1);
  });
});
