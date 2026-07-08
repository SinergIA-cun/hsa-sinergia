import { describe, it, expect } from 'vitest';
import { computeQuote } from './engine.js';
import type { Catalog } from '../types.js';

const catalog: Catalog = {
  ivaRate: 0.16,
  extraHourRate: 0.05,
  foodDiscountRate: 0.05,
  rentalPrices: [
    // Los Arcos (id 'arcos')
    { spaceId: 'arcos', min: 1, max: 50, prices: { viernes: 34500, viernesEspecial: 17250, sabado: 42000, domAJue: 30000 } },
    { spaceId: 'arcos', min: 201, max: 300, prices: { viernes: 100000, viernesEspecial: 50000, sabado: 108500, domAJue: 90500 } },
    // La Cúpula (id 'cupula')
    { spaceId: 'cupula', min: 50, max: 300, prices: { viernes: 157000, viernesEspecial: 78500, sabado: 174000, domAJue: 139000 } },
    // Capilla (id 'capilla')
    { spaceId: 'capilla', min: 1, max: null, prices: { viernes: 0, viernesEspecial: 0, sabado: 5000, domAJue: 0 } },
  ],
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
    { id: 'valet', name: 'Valet parking', kind: 'porUnidad', price: 100 },
    { id: 'dj', name: 'DJ', kind: 'fijo', price: 2950 },
  ],
};

describe('computeQuote', () => {
  it('renta simple sábado (Los Arcos, 250 pax) = 108,500 con IVA', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 0, addOns: [],
    });
    expect(r.rentaTotal).toBe(108500);
    expect(r.total).toBe(108500); // renta ya trae IVA, sin más conceptos
  });

  it('renta + alimentos aplica 5% de descuento en renta y agrega IVA a alimentos', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 0, foodPackageId: 'boda-supreme', addOns: [],
    });
    // Renta 108500; descuento 5% = 5425 => renta neta 103075 (con IVA)
    // Alimentos 799*250 = 199750 sin IVA; IVA 16% = 31960 => 231710
    // total = 103075 + 231710 = 334785
    const alimentosBase = 799 * 250;
    const descuento = 108500 * 0.05;
    const rentaNeta = 108500 - descuento;
    const alimentosConIva = alimentosBase * 1.16;
    expect(r.total).toBeCloseTo(rentaNeta + alimentosConIva, 2);
  });

  it('hora extra = 5% de la renta por hora', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 2, addOns: [],
    });
    expect(r.total).toBeCloseTo(108500 + 2 * 0.05 * 108500, 2);
  });

  it('add-ons: valet porUnidad e IVA; DJ fijo con IVA', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 0, addOns: [{ addOnId: 'valet', cantidad: 50 }, { addOnId: 'dj', cantidad: 1 }],
    });
    const addonBase = 100 * 50 + 2950;
    expect(r.total).toBeCloseTo(108500 + addonBase * 1.16, 2);
  });

  it('capilla en sábado cuesta 5,000; suma de espacios', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos', 'capilla'],
      horasExtra: 0, addOns: [],
    });
    expect(r.rentaTotal).toBe(108500 + 5000);
  });

  it('lanza error si el espacio no tiene rango para los invitados', () => {
    expect(() =>
      computeQuote(catalog, { fecha: '2027-05-08', invitados: 700, spaceIds: ['arcos'], horasExtra: 0, addOns: [] }),
    ).toThrow(/rango/i);
  });

  it('paquete con ivaIncluido=true NO recibe 16% extra', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 0, foodPackageId: 'boda-conIva', addOns: [],
    });
    // Renta 108500; descuento 5% = 5425 => renta neta 103075 (con IVA)
    // Alimentos 800*250 = 200000 YA con IVA (no se agrega 16%)
    // total = 103075 + 200000 = 303075
    expect(r.total).toBeCloseTo(103075 + 200000, 2);
  });

  it('horas extra + alimentos: ambos 5% sobre la renta de espacios base (no compuestos)', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 2, foodPackageId: 'boda-supreme', addOns: [],
    });
    // rentaEspacios 108500; horasExtra = 108500*0.05*2 = 10850; descuento = 108500*0.05 = 5425
    // rentaConIva = 108500 + 10850 - 5425 = 113925
    // alimentos 799*250 = 199750 sin IVA; +16% = 231710
    // total = 113925 + 231710 = 345635
    expect(r.total).toBeCloseTo(113925 + 199750 * 1.16, 2);
  });

  it('subtotal + iva === total', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 1, foodPackageId: 'boda-supreme',
      addOns: [{ addOnId: 'valet', cantidad: 50 }],
    });
    expect(r.subtotal + r.iva).toBeCloseTo(r.total, 2);
  });

  it('lanza error si falta el precio del día para un espacio', () => {
    const roto: Catalog = {
      ...catalog,
      rentalPrices: [
        // 'sabado' ausente => debe lanzar en fecha sábado
        { spaceId: 'roto', min: 1, max: null, prices: { viernes: 0, viernesEspecial: 0, domAJue: 0 } as unknown as Record<'viernes' | 'viernesEspecial' | 'sabado' | 'domAJue', number> },
      ],
    };
    expect(() =>
      computeQuote(roto, { fecha: '2027-05-08', invitados: 100, spaceIds: ['roto'], horasExtra: 0, addOns: [] }),
    ).toThrow(/Falta precio/i);
  });
});
