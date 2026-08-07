import { describe, it, expect } from 'vitest';
import { computeQuote } from './engine.js';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
import type { Catalog } from '../types.js';
import type { QuoteSelection } from '../schemas.js';

const catalog: Catalog = {
  ivaRate: 0.16,
  extraHourRate: 0.05,
  foodDiscountRate: 0.05,
  capillaSabado: 5000,
  djHoraExtraByEventType: { boda: 2950, cumpleanos: 2750 },
  rentalPrices: [
    // Los Arcos (id 'arcos')
    { spaceId: 'arcos', min: 1, max: 50, prices: { viernes: 34500, viernesEspecial: 17250, sabado: 42000, domAJue: 30000 } },
    { spaceId: 'arcos', min: 201, max: 300, prices: { viernes: 100000, viernesEspecial: 50000, sabado: 108500, domAJue: 90500 } },
    // La Cúpula (id 'cupula')
    { spaceId: 'cupula', min: 50, max: 300, prices: { viernes: 157000, viernesEspecial: 78500, sabado: 174000, domAJue: 139000 } },
  ],
  // Renta plana (Team Building): mismo precio todos los días. Arcos 201-300 = 50,000.
  rentalPricesFlat: [
    { spaceId: 'arcos', min: 201, max: 300, prices: { viernes: 50000, viernesEspecial: 50000, sabado: 50000, domAJue: 50000 } },
  ],
  flatRentalEventTypeIds: ['team-building'],
  foodPackages: [
    {
      id: 'boda-supreme', eventTypeId: 'boda', name: 'SUPREME', ivaIncluded: false,
      brackets: [
        { packageId: 'boda-supreme', min: 201, max: 300, pricePerPerson: 799 },
      ],
    },
    {
      id: 'boda-conIva', eventTypeId: 'boda', name: 'CON IVA', ivaIncluded: true,
      brackets: [
        { packageId: 'boda-conIva', min: 201, max: 300, pricePerPerson: 800 },
      ],
    },
  ],
  addOns: [
    { id: 'porunidad', name: 'Servicio por unidad', kind: 'porUnidad', price: 100 },
    { id: 'dj', name: 'DJ', kind: 'fijo', price: 2950 },
  ],
};

/** Selección base (sábado, Los Arcos 250 pax); se sobreescribe lo necesario. */
function mk(overrides: Partial<QuoteSelection> = {}): QuoteSelection {
  return {
    fecha: '2027-05-08', // sábado
    invitados: 250,
    spaceIds: ['arcos'],
    horasExtra: 0,
    usaCapilla: false,
    usaDjHoraExtra: false,
    addOns: [],
    ...overrides,
  };
}

describe('computeQuote', () => {
  it('renta simple sábado (Los Arcos, 250 pax) = 108,500 con IVA', () => {
    const r = computeQuote(catalog, mk());
    expect(r.rentaTotal).toBe(108500);
    expect(r.total).toBe(108500); // renta ya trae IVA, sin más conceptos
  });

  it('renta + alimentos aplica 5% de descuento en renta y agrega IVA a alimentos', () => {
    const r = computeQuote(catalog, mk({ foodPackageId: 'boda-supreme' }));
    const alimentosBase = 799 * 250;
    const descuento = 108500 * 0.05;
    const rentaNeta = 108500 - descuento;
    const alimentosConIva = alimentosBase * 1.16;
    expect(r.total).toBeCloseTo(rentaNeta + alimentosConIva, 2);
  });

  it('hora extra = 5% de la renta por hora', () => {
    const r = computeQuote(catalog, mk({ horasExtra: 2 }));
    expect(r.total).toBeCloseTo(108500 + 2 * 0.05 * 108500, 2);
  });

  it('add-ons: porUnidad e IVA; DJ fijo con IVA', () => {
    const r = computeQuote(catalog, mk({ addOns: [{ addOnId: 'porunidad', cantidad: 50 }, { addOnId: 'dj', cantidad: 1 }] }));
    const addonBase = 100 * 50 + 2950;
    expect(r.total).toBeCloseTo(108500 + addonBase * 1.16, 2);
  });

  it('usaCapilla en sábado agrega $5,000; entre semana es cortesía ($0)', () => {
    const sab = computeQuote(catalog, mk({ usaCapilla: true }));
    expect(sab.rentaTotal).toBe(108500 + 5000);

    // Jueves: capilla no cuesta (cortesía) — comparado contra la misma sin capilla.
    const jueSin = computeQuote(catalog, mk({ fecha: '2027-05-06' }));
    const jueCon = computeQuote(catalog, mk({ fecha: '2027-05-06', usaCapilla: true }));
    expect(jueCon.rentaTotal).toBe(jueSin.rentaTotal);
  });

  it('lanza error si el espacio no tiene rango para los invitados', () => {
    expect(() => computeQuote(catalog, mk({ invitados: 700 }))).toThrow(/rango/i);
  });

  it('paquete con ivaIncluido=true NO recibe 16% extra', () => {
    const r = computeQuote(catalog, mk({ foodPackageId: 'boda-conIva' }));
    expect(r.total).toBeCloseTo(103075 + 200000, 2);
  });

  it('horas extra + alimentos: ambos 5% sobre la renta de espacios base (no compuestos)', () => {
    const r = computeQuote(catalog, mk({ horasExtra: 2, foodPackageId: 'boda-supreme' }));
    expect(r.total).toBeCloseTo(113925 + 199750 * 1.16, 2);
  });

  it('rentaTotal + otrosTotal === total y otros = alimentos + servicios', () => {
    const r = computeQuote(
      catalog,
      mk({ foodPackageId: 'boda-supreme', addOns: [{ addOnId: 'porunidad', cantidad: 50 }] }),
    );
    expect(round2(r.rentaTotal + r.otrosTotal)).toBe(r.total);
    // "otros" = alimentos con IVA + add-on por unidad con IVA.
    const otrosEsperado = 799 * 250 * 1.16 + 100 * 50 * 1.16;
    expect(r.otrosTotal).toBeCloseTo(otrosEsperado, 2);
  });

  it('sin alimentos ni servicios, otrosTotal = 0 y toda la renta es rentaTotal', () => {
    const r = computeQuote(catalog, mk());
    expect(r.otrosTotal).toBe(0);
    expect(r.rentaTotal).toBe(r.total);
  });

  it('el descuento 5% va en el grupo renta y los alimentos en otros', () => {
    const r = computeQuote(catalog, mk({ foodPackageId: 'boda-supreme' }));
    const descuento = r.lines.find((l) => l.concepto.startsWith('Descuento'));
    const alimentos = r.lines.find((l) => l.concepto.startsWith('Alimentos'));
    expect(descuento?.grupo).toBe('renta');
    expect(alimentos?.grupo).toBe('otros');
    // rentaTotal ya trae el descuento restado.
    expect(r.rentaTotal).toBeCloseTo(108500 - 108500 * 0.05, 2);
  });

  it('DJ Hora extra: precio por tipo de evento × horas extra, con IVA agregado', () => {
    const r = computeQuote(
      catalog,
      mk({ eventTypeId: 'boda', usaDjHoraExtra: true, horasExtra: 2 }),
    );
    const dj = r.lines.find((l) => l.concepto === 'DJ Hora extra');
    expect(dj?.monto).toBe(2950 * 2);
    expect(dj?.grupo).toBe('otros');
    // Renta con horas extra + DJ (2×2950) con IVA.
    const rentaConHoras = 108500 + 2 * 0.05 * 108500;
    expect(r.total).toBeCloseTo(rentaConHoras + 2950 * 2 * 1.16, 2);
  });

  it('DJ Hora extra sin horas extra no cobra nada', () => {
    const r = computeQuote(catalog, mk({ eventTypeId: 'boda', usaDjHoraExtra: true, horasExtra: 0 }));
    expect(r.lines.find((l) => l.concepto === 'DJ Hora extra')).toBeUndefined();
    expect(r.total).toBe(108500);
  });

  it('Team Building usa renta plana: mismo precio en sábado que entre semana', () => {
    const sab = computeQuote(catalog, mk({ eventTypeId: 'team-building', fecha: '2027-05-08' }));
    const jue = computeQuote(catalog, mk({ eventTypeId: 'team-building', fecha: '2027-05-06' }));
    expect(sab.rentaTotal).toBe(50000);
    expect(jue.rentaTotal).toBe(50000); // plano: no varía por día (vs. 108,500 sábado normal)
  });

  it('un evento normal NO usa la renta plana (sábado sigue en 108,500)', () => {
    const r = computeQuote(catalog, mk({ eventTypeId: 'boda', fecha: '2027-05-08' }));
    expect(r.rentaTotal).toBe(108500);
  });

  it('cada bloque cuadra: rentaSubtotal+rentaIva=rentaTotal y otrosSubtotal+otrosIva=otrosTotal', () => {
    const r = computeQuote(
      catalog,
      mk({ foodPackageId: 'boda-supreme', addOns: [{ addOnId: 'porunidad', cantidad: 50 }] }),
    );
    expect(round2(r.rentaSubtotal + r.rentaIva)).toBe(r.rentaTotal);
    expect(round2(r.otrosSubtotal + r.otrosIva)).toBe(r.otrosTotal);
    expect(round2(r.rentaSubtotal + r.otrosSubtotal)).toBe(r.subtotal);
    expect(round2(r.rentaTotal + r.otrosTotal)).toBe(r.total);
    // La renta trae IVA incluido: subtotal = total / 1.16.
    expect(r.rentaSubtotal).toBeCloseTo(r.rentaTotal / 1.16, 2);
  });

  it('subtotal + iva === total', () => {
    const r = computeQuote(catalog, mk({ horasExtra: 1, foodPackageId: 'boda-supreme', addOns: [{ addOnId: 'porunidad', cantidad: 50 }] }));
    expect(r.subtotal + r.iva).toBeCloseTo(r.total, 2);
  });

  it('lanza error si falta el precio del día para un espacio', () => {
    const roto: Catalog = {
      ...catalog,
      rentalPrices: [
        { spaceId: 'roto', min: 1, max: null, prices: { viernes: 0, viernesEspecial: 0, domAJue: 0 } as unknown as Record<'viernes' | 'viernesEspecial' | 'sabado' | 'domAJue', number> },
      ],
    };
    expect(() => computeQuote(roto, mk({ spaceIds: ['roto'], invitados: 100 }))).toThrow(/Falta precio/i);
  });

  it('las líneas de renta llevan spaceId; las demás no', () => {
    // El catálogo de prueba tiene 'arcos' (201-300) y 'cupula' (50-300): con 250
    // invitados ambos tienen fila de renta.
    const b = computeQuote(catalog, {
      fecha: '2027-05-08',
      invitados: 250,
      spaceIds: ['arcos', 'cupula'],
      horasExtra: 1,
      usaCapilla: false,
      usaDjHoraExtra: false,
      addOns: [],
    });

    const rentas = b.lines.filter((l) => l.spaceId != null);
    expect(rentas).toHaveLength(2);
    expect(rentas.map((l) => l.spaceId).sort()).toEqual(['arcos', 'cupula']);

    const horasExtra = b.lines.find((l) => l.concepto === 'Horas extra')!;
    expect(horasExtra.spaceId).toBeUndefined();
  });
});
