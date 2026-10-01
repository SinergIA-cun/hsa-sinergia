import { describe, it, expect } from 'vitest';
import { computeQuote, porPersonaDelNivel } from './engine.js';
import { precioDelDia } from './precioDelDia.js';
import type { Catalog } from '../types.js';
import type { QuoteSelection } from '../schemas.js';

/**
 * "En la lista de precios necesito poder desactivar cosas: viernes especial hay
 * veces que no queremos ofrecerlo, o en renta plana viernes y sábado no se
 * ofrece. Ahorita se marca en ceros" (el dueño). Un cero cobraba $0; un precio
 * en `null` es "no aplica".
 */

const fila = (prices: Partial<Record<'viernes' | 'viernesEspecial' | 'sabado' | 'domAJue', number | null>>) => ({
  spaceId: 'arcos',
  min: 1,
  max: 100,
  prices: { viernes: 70000, viernesEspecial: 35000, sabado: 76000, domAJue: 58500, ...prices },
});

const cat = (over: Partial<Catalog> = {}): Catalog => ({
  ivaRate: 0.16,
  extraHourRate: 0.05,
  foodDiscountRate: 0.05,
  capillaSabado: 5000,
  djHoraExtraByEventType: {},
  rentalPrices: [fila({})],
  rentalPricesFlat: [fila({ viernes: null, viernesEspecial: null, sabado: null, domAJue: 35000 })],
  flatRentalEventTypeIds: ['team-building'],
  foodPackages: [],
  addOns: [],
  spaceNames: { arcos: 'Arcos' },
  ...over,
});

const sel = (fecha: string, over: Partial<QuoteSelection> = {}): QuoteSelection => ({
  fecha,
  invitados: 80,
  spaceIds: ['arcos'],
  horasExtra: 0,
  usaCapilla: false,
  usaDjHoraExtra: false,
  addOns: [],
  extras: [],
  ...over,
});

const VIERNES_ESPECIAL = '2027-05-07'; // viernes de mayo
const SABADO = '2027-05-08';
const MARTES = '2027-05-04';

describe('precio "no aplica"', () => {
  it('sin viernes especial, el viernes especial se cobra como viernes normal', () => {
    const c = cat({ rentalPrices: [fila({ viernesEspecial: null })] });
    expect(computeQuote(c, sel(VIERNES_ESPECIAL)).rentaTotal).toBe(70000);
    expect(precioDelDia({ viernes: 70000, viernesEspecial: null, sabado: 1, domAJue: 1 }, 'viernesEspecial')).toBe(70000);
  });

  it('un día que no aplica no se cotiza, y lo dice con el nombre del espacio', () => {
    const c = cat({ rentalPrices: [fila({ sabado: null })] });
    expect(() => computeQuote(c, sel(SABADO))).toThrow('Arcos no se ofrece en sábado');
    // Los demás días siguen igual.
    expect(computeQuote(c, sel(MARTES)).rentaTotal).toBe(58500);
  });

  it('sin viernes normal ni especial, el viernes especial tampoco se ofrece', () => {
    const c = cat({ rentalPrices: [fila({ viernes: null, viernesEspecial: null })] });
    expect(() => computeQuote(c, sel(VIERNES_ESPECIAL))).toThrow('Arcos no se ofrece en viernes');
  });

  it('renta plana: viernes y sábado no se ofrecen; entre semana sí', () => {
    const tb = { eventTypeId: 'team-building' };
    expect(() => computeQuote(cat(), sel(SABADO, tb))).toThrow('no se ofrece en sábado');
    expect(computeQuote(cat(), sel(MARTES, tb)).rentaTotal).toBe(35000);
  });

  it('sin nombres en el catálogo, el mensaje no enseña un id', () => {
    const c = cat({ rentalPrices: [fila({ sabado: null })], spaceNames: undefined });
    expect(() => computeQuote(c, sel(SABADO))).toThrow('El espacio elegido no se ofrece en sábado');
  });

  it('el precio por persona del nivel también respeta el "no aplica"', () => {
    const c = cat({ rentalPrices: [fila({ viernesEspecial: null })] });
    expect(porPersonaDelNivel(c, sel(VIERNES_ESPECIAL)).renta).toBe(700);
    const sinSabado = cat({ rentalPrices: [fila({ sabado: null })] });
    expect(porPersonaDelNivel(sinSabado, sel(SABADO)).renta).toBeNull();
  });
});
