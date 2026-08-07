import { describe, it, expect } from 'vitest';
import { prorratearRenta } from './prorrateo.js';

describe('prorratearRenta', () => {
  it('reparte las horas extra en proporción a la renta de cada salón', () => {
    // Cúpula 174,000 + Arcos 108,500 = 282,500 de catálogo.
    // rentaTotal 300,000 → sobran 17,500 por repartir.
    const r = prorratearRenta(new Map([['cup', 174_000], ['arc', 108_500]]), 300_000);
    expect(r.get('cup')! + r.get('arc')!).toBe(300_000);
    // Cúpula pesa 174000/282500 = 0.615929…
    expect(r.get('cup')).toBeCloseTo(184_778.76, 2);
  });

  it('con un solo salón le asigna toda la renta', () => {
    const r = prorratearRenta(new Map([['cup', 174_000]]), 196_400);
    expect(r.get('cup')).toBe(196_400);
  });

  it('sin renta de catálogo reparte en partes iguales', () => {
    const r = prorratearRenta(new Map([['a', 0], ['b', 0]]), 100_000);
    expect(r.get('a')).toBe(50_000);
    expect(r.get('b')).toBe(50_000);
  });

  it('el último salón absorbe el centavo del redondeo', () => {
    const r = prorratearRenta(new Map([['a', 1], ['b', 1], ['c', 1]]), 100);
    expect(r.get('a')! + r.get('b')! + r.get('c')!).toBe(100);
  });

  it('sin salones devuelve un mapa vacío', () => {
    expect(prorratearRenta(new Map(), 100_000).size).toBe(0);
  });
});
