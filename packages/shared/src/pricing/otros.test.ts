import { describe, it, expect } from 'vitest';
import { computeQuote } from './engine.js';
import { conOtrosRecalculados, seleccionSoloOtros } from './otros.js';
import { desgloseImportado } from '../bi/importacion.js';
import type { Catalog } from '../types.js';
import type { QuoteSelection } from '../schemas.js';

const catalog: Catalog = {
  ivaRate: 0.16,
  extraHourRate: 0.05,
  foodDiscountRate: 0.05,
  capillaSabado: 5000,
  djHoraExtraByEventType: {},
  rentalPrices: [
    { spaceId: 'arcos', min: 51, max: 200, prices: { viernes: 86000, viernesEspecial: 86000, sabado: 93500, domAJue: 74000 } },
  ],
  rentalPricesFlat: [],
  flatRentalEventTypeIds: [],
  foodPackages: [
    {
      id: 'supreme', eventTypeId: 'boda', name: 'SUPREME', ivaIncluded: false,
      brackets: [{ packageId: 'supreme', min: 51, max: 200, pricePerPerson: 1000 }],
    },
  ],
  addOns: [],
};

const sel = (extra: Partial<QuoteSelection> = {}): QuoteSelection => ({
  fecha: '2027-05-08',
  invitados: 100,
  spaceIds: ['arcos'],
  horasExtra: 0,
  usaCapilla: false,
  usaDjHoraExtra: false,
  addOns: [],
  extras: [],
  ...extra,
});

describe('alimentos y servicios sobre un desglose congelado', () => {
  it('importado del BI: la renta pactada se queda y el paquete se suma aparte', () => {
    const pactado = desgloseImportado({ salones: [{ spaceId: 'arcos', nombre: 'Arcos' }], rentaTotal: 60_000, otrosTotal: 0, ivaRate: 0.16 });
    const otros = computeQuote(catalog, seleccionSoloOtros(sel({ foodPackageId: 'supreme', descuentoAlimentosPct: 5 })));
    const r = conOtrosRecalculados(pactado, otros, 0.16);

    expect(r.rentaTotal).toBe(60_000);
    expect(r.lines.filter((l) => l.grupo === 'renta').map((l) => l.monto)).toEqual([60_000]);
    // 100 × 1,000 sin IVA = 116,000 con IVA; sin la promoción (es renta).
    expect(r.otrosTotal).toBe(116_000);
    expect(r.total).toBe(176_000);
    expect(r.lines.some((l) => l.ref?.tipo === 'descuentoAlimentos')).toBe(false);
  });

  it('conserva el renglón pactado del BI y reemplaza lo calculado antes', () => {
    const pactado = desgloseImportado({ salones: [{ spaceId: 'arcos', nombre: 'Arcos' }], rentaTotal: 60_000, otrosTotal: 20_000, ivaRate: 0.16 });
    const conPaquete = conOtrosRecalculados(pactado, computeQuote(catalog, seleccionSoloOtros(sel({ foodPackageId: 'supreme' }))), 0.16);
    const sinPaquete = conOtrosRecalculados(conPaquete, computeQuote(catalog, seleccionSoloOtros(sel())), 0.16);

    expect(conPaquete.otrosTotal).toBe(20_000 + 116_000);
    expect(sinPaquete.otrosTotal).toBe(20_000);
    expect(sinPaquete.lines.map((l) => l.ref?.tipo)).toEqual(['rentaSalon', 'pactado']);
  });

  it('un servicio del evento lleva su proveedor y su comisión', () => {
    const r = computeQuote(catalog, sel({
      extras: [{ nombre: 'Grupo musical', kind: 'fijo', monto: 23_200, cantidad: 1, proveedor: 'Los Del Norte', comisionMonto: 2_000 }],
    }));
    expect(r.lines.find((l) => l.ref?.tipo === 'servicioEvento')?.ref).toMatchObject({
      proveedorNombre: 'Los Del Norte',
      comisionMonto: 2_000,
    });
  });
});
