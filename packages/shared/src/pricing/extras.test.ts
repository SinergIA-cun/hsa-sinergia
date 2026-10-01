import { describe, it, expect } from 'vitest';
import { computeQuote, porPersonaDelNivel } from './engine.js';
import { nivelConExtras } from './brackets.js';
import type { Catalog } from '../types.js';
import type { QuoteSelection } from '../schemas.js';

/**
 * Personas extra (pedido del dueño, 1-oct-2026): "cuando un evento es de 110 o
 * 120 personas se le cotiza con el nivel de 100, pero se le agregan 10 o 20
 * personas extras". Los números son los del catálogo 2027 real: Arcos en
 * sábado, 51–100 = $76,000 y 101–200 = $93,500; Boda SUPREME 51–100 = $1,019 y
 * 101–150 = $999 por persona.
 */
const base: Catalog = {
  ivaRate: 0.16,
  extraHourRate: 0.05,
  foodDiscountRate: 0.05,
  capillaSabado: 5000,
  djHoraExtraByEventType: {},
  rentalPrices: [
    { spaceId: 'arcos', min: 51, max: 100, prices: { viernes: 70000, viernesEspecial: 70000, sabado: 76000, domAJue: 58500 } },
    { spaceId: 'arcos', min: 101, max: 200, prices: { viernes: 86000, viernesEspecial: 86000, sabado: 93500, domAJue: 74000 } },
  ],
  rentalPricesFlat: [],
  flatRentalEventTypeIds: [],
  foodPackages: [
    {
      id: 'supreme', eventTypeId: 'boda', name: 'SUPREME', ivaIncluded: false,
      brackets: [
        { packageId: 'supreme', min: 51, max: 100, pricePerPerson: 1019 },
        { packageId: 'supreme', min: 101, max: 150, pricePerPerson: 999 },
      ],
    },
  ],
  addOns: [],
};
const con = (tol: number): Catalog => ({ ...base, toleranciaExtras: tol });

function sel(invitados: number, extra: Partial<QuoteSelection> = {}): QuoteSelection {
  return {
    fecha: '2027-05-08', // sábado
    invitados,
    spaceIds: ['arcos'],
    horasExtra: 0,
    usaCapilla: false,
    usaDjHoraExtra: false,
    addOns: [],
    extras: [],
    ...extra,
  };
}

const renta = (c: Catalog, n: number) => computeQuote(c, sel(n)).lines.find((l) => l.spaceId === 'arcos')!;

describe('personas extra en la renta', () => {
  it('110 personas con tope 20: nivel de 100 más 10 extra a $760 (76,000 / 100)', () => {
    const l = renta(con(20), 110);
    expect(l.monto).toBe(76_000 + 10 * 760);
    expect(l.detalle).toBe('nivel hasta 100 + 10 personas extra × 760');
  });

  it('120 personas con tope 20: todavía extras', () => {
    expect(renta(con(20), 120).monto).toBe(76_000 + 20 * 760);
  });

  it('121 personas con tope 20: ya brinca al nivel de 101–200', () => {
    expect(renta(con(20), 121).monto).toBe(93_500);
  });

  it('sin tope configurado (0) se cobra como siempre: el nivel completo', () => {
    expect(renta(base, 110).monto).toBe(93_500);
    expect(renta(con(0), 110).monto).toBe(93_500);
  });

  it('dentro de un nivel no hay extras', () => {
    expect(renta(con(20), 100).monto).toBe(76_000);
    expect(renta(con(20), 150).monto).toBe(93_500);
  });

  it('el 5% de hora extra y el descuento por alimentos se calculan sobre la renta con extras', () => {
    const r = computeQuote(con(20), sel(110, { horasExtra: 1 }));
    const he = r.lines.find((l) => l.concepto === 'Horas extra')!;
    expect(he.monto).toBe(Math.round(83_600 * 0.05 * 100) / 100);
  });
});

describe('personas extra en los alimentos', () => {
  it('110 personas con tope 20: las 110 al precio por persona del nivel de 100', () => {
    const r = computeQuote(con(20), sel(110, { foodPackageId: 'supreme' }));
    const a = r.lines.find((l) => l.concepto === 'Alimentos SUPREME')!;
    expect(a.monto).toBe(110 * 1019);
    expect(a.detalle).toContain('nivel hasta 100: 10 extra');
  });

  it('sin tope, los alimentos van al precio de su rango', () => {
    const r = computeQuote(base, sel(110, { foodPackageId: 'supreme' }));
    expect(r.lines.find((l) => l.concepto === 'Alimentos SUPREME')!.monto).toBe(110 * 999);
  });
});

describe('nivelConExtras', () => {
  const rows = [
    { min: 1, max: 50 },
    { min: 51, max: 100 },
    { min: 101, max: null },
  ];
  it('un rango sin anterior contiguo no tiene extras', () => {
    expect(nivelConExtras(rows, rows[0]!, 10, 20)).toEqual({ row: rows[0], extras: 0 });
  });
  it('el último rango abierto también admite extras del anterior', () => {
    expect(nivelConExtras(rows, rows[2]!, 105, 20)).toEqual({ row: rows[1], extras: 5 });
  });
});

describe('porPersonaDelNivel (lo que sugiere el punto de venta)', () => {
  it('110 personas con tope 20: renta $760 y alimentos $1,019 + IVA', () => {
    expect(porPersonaDelNivel(con(20), sel(110, { foodPackageId: 'supreme' }))).toEqual({
      renta: 760,
      alimentos: Math.round(1019 * 1.16),
    });
  });
  it('sin paquete de alimentos, alimentos es null', () => {
    // Sin tope, 110 cae en 101–200: 93,500 / 200.
    expect(porPersonaDelNivel(base, sel(110))).toEqual({ renta: Math.round(93_500 / 200), alimentos: null });
  });
});
