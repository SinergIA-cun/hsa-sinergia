import { describe, it, expect } from 'vitest';
import { computeQuote } from './engine.js';
import { bracketDeParte, capacidadTotal, repartirInvitados } from './reparto.js';
import type { Catalog, RentalPriceRow } from '../types.js';

/**
 * Varios salones en un mismo evento.
 *
 * El caso del dueño: 600 invitados en dos salones de 400 no se podían cotizar,
 * aunque entre los dos caben 800. Lo que se fija aquí es la regla que eligió:
 * **cada salón cobra según la gente que le toca**, no dos salones llenos.
 */

const precios = (sabado: number) => ({ viernes: sabado, viernesEspecial: sabado, sabado, domAJue: sabado });

/** Los salones reales: Arcos y Campos hasta 400, La Cúpula hasta 800. */
const RENTA: RentalPriceRow[] = [
  { spaceId: 'arcos', min: 1, max: 50, prices: precios(42_000) },
  { spaceId: 'arcos', min: 51, max: 100, prices: precios(76_000) },
  { spaceId: 'arcos', min: 101, max: 200, prices: precios(93_500) },
  { spaceId: 'arcos', min: 201, max: 300, prices: precios(108_500) },
  { spaceId: 'arcos', min: 301, max: 400, prices: precios(123_000) },
  { spaceId: 'campos', min: 1, max: 50, prices: precios(42_000) },
  { spaceId: 'campos', min: 51, max: 100, prices: precios(76_000) },
  { spaceId: 'campos', min: 101, max: 200, prices: precios(93_500) },
  { spaceId: 'campos', min: 201, max: 300, prices: precios(108_500) },
  { spaceId: 'campos', min: 301, max: 400, prices: precios(123_000) },
  // La Cúpula empieza en 50: es la que prueba que una parte chica no truena.
  { spaceId: 'cupula', min: 50, max: 300, prices: precios(174_000) },
  { spaceId: 'cupula', min: 301, max: 500, prices: precios(194_000) },
  { spaceId: 'cupula', min: 501, max: 650, prices: precios(218_500) },
  { spaceId: 'cupula', min: 651, max: 800, prices: precios(233_500) },
];

const catalog: Catalog = {
  ivaRate: 0.16,
  extraHourRate: 0.05,
  foodDiscountRate: 0.05,
  capillaSabado: 5000,
  djHoraExtraByEventType: {},
  rentalPrices: RENTA,
  rentalPricesFlat: [],
  flatRentalEventTypeIds: [],
  foodPackages: [],
  addOns: [],
};

function cotizar(spaceIds: string[], invitados: number) {
  return computeQuote(catalog, {
    fecha: '2027-05-08', // sábado
    invitados,
    spaceIds,
    horasExtra: 0,
    usaCapilla: false,
    usaDjHoraExtra: false,
    addOns: [],
    extras: [],
  });
}

function rentaDe(b: ReturnType<typeof cotizar>, spaceId: string): number {
  return b.lines.find((l) => l.spaceId === spaceId)?.monto ?? 0;
}

describe('el reparto de invitados', () => {
  it('con un solo salón se lleva a toda la gente (no cambia nada de lo de antes)', () => {
    const r = repartirInvitados(['arcos'], RENTA, 250);
    expect(r.get('arcos')).toBe(250);
  });

  it('reparte en proporción al cupo, no en partes iguales', () => {
    // En partes iguales, 900 entre La Cúpula (800) y Arcos (400) darían 450 en
    // Arcos, que NO caben. Proporcional da 600 y 300, que sí.
    const r = repartirInvitados(['cupula', 'arcos'], RENTA, 900);
    expect(r.get('cupula')).toBe(600);
    expect(r.get('arcos')).toBe(300);
  });

  it('las partes suman exactamente el total, aunque el redondeo no cierre', () => {
    for (const n of [101, 137, 251, 599, 777]) {
      const r = repartirInvitados(['cupula', 'arcos'], RENTA, n);
      expect([...r.values()].reduce((s, x) => s + x, 0), `con ${n} invitados`).toBe(n);
    }
  });

  it('nadie se queda en cero por un redondeo', () => {
    // Un salón con cero personas no encontraría rango y tumbaría la cotización
    // entera. Con menos invitados que salones —absurdo pero capturable— cada uno
    // se cotiza por una persona; es la única vez que las partes no cierran, y es
    // preferible a no poder cotizar.
    const r = repartirInvitados(['cupula', 'arcos'], RENTA, 1);
    expect([...r.values()].every((n) => n >= 1)).toBe(true);
  });
});

describe('el caso del dueño', () => {
  it('600 invitados en dos salones de 400 sí se cotizan', () => {
    const b = cotizar(['arcos', 'campos'], 600);
    // 300 en cada uno: cada salón cobra su rango de 201–300.
    expect(rentaDe(b, 'arcos')).toBe(108_500);
    expect(rentaDe(b, 'campos')).toBe(108_500);
    expect(b.rentaTotal).toBe(217_000);
  });

  it('no se cobran dos salones llenos por repartir a la gente en dos', () => {
    // La decisión del dueño, dicha como número. Con 200 invitados en dos salones
    // le tocan 100 a cada uno y cada uno cobra su rango de 51–100 ($76,000). Si
    // alguien vuelve a la regla de "cada salón a su tope", o a la vieja de buscar
    // el rango con el TOTAL, esto da $187,000 y truena.
    expect(cotizar(['arcos', 'campos'], 200).rentaTotal).toBe(152_000);
  });

  it('cada renglón dice cuántos invitados le tocaron', () => {
    const b = cotizar(['arcos', 'campos'], 600);
    expect(b.lines.find((l) => l.spaceId === 'arcos')?.detalle).toBe('300 de 600 invitados');
  });

  it('con un solo salón el renglón no habla de repartos', () => {
    const b = cotizar(['arcos'], 250);
    expect(b.lines.find((l) => l.spaceId === 'arcos')?.detalle).toBeUndefined();
  });

  it('801 invitados no caben en dos salones de 400, y el error dice el cupo', () => {
    expect(() => cotizar(['arcos', 'campos'], 801)).toThrow(/no caben.*cupo 800/i);
  });

  it('un evento chico repartido no truena aunque a un salón le toque menos de su mínimo', () => {
    // La Cúpula empieza en 50. Con 60 personas entre Cúpula y Arcos le tocan 40:
    // rentarla para 40 cuesta su precio de entrada, no da error.
    const b = cotizar(['cupula', 'arcos'], 60);
    expect(rentaDe(b, 'cupula')).toBe(174_000);
    expect(b.rentaTotal).toBeGreaterThan(0);
  });
});

describe('los cimientos', () => {
  it('el cupo de un salón sale de sus propios rangos', () => {
    expect(capacidadTotal(['arcos'], RENTA)).toBe(400);
    expect(capacidadTotal(['arcos', 'campos'], RENTA)).toBe(800);
    expect(capacidadTotal(['cupula', 'arcos'], RENTA)).toBe(1200);
  });

  it('una parte en un hueco del catálogo cae en el siguiente rango, no en el error', () => {
    const conHueco: RentalPriceRow[] = [
      { spaceId: 'x', min: 1, max: 50, prices: precios(1000) },
      { spaceId: 'x', min: 201, max: 300, prices: precios(5000) },
    ];
    expect(bracketDeParte(conHueco, 125)?.min).toBe(201);
  });

  it('arriba del cupo no hay rango: eso sí es "no cabe"', () => {
    expect(bracketDeParte(RENTA.filter((r) => r.spaceId === 'arcos'), 500)).toBeUndefined();
  });
});
