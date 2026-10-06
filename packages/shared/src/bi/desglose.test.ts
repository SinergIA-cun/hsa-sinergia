import { describe, it, expect } from 'vitest';
import { desgloseParaBI } from './desglose.js';
import { desgloseImportado } from './importacion.js';
import type { QuoteLine } from '../types.js';

const IVA = 0.16;

describe('desgloseParaBI', () => {
  it('pone IVA a lo que no lo trae y cada bloque suma su total exacto', () => {
    const lines: QuoteLine[] = [
      { concepto: 'Renta Arcos', monto: 108500, ivaIncluido: true, grupo: 'renta', spaceId: 'arcos', ref: { tipo: 'rentaSalon', id: 'arcos', cantidad: 1, unidad: 'evento', precioUnitario: 108500 } },
      { concepto: 'Alimentos SUPREME', detalle: '250 × 799', monto: 199750, ivaIncluido: false, grupo: 'otros', ref: { tipo: 'alimentos', id: 'pkg1', cantidad: 250, unidad: 'personas', precioUnitario: 799 } },
      { concepto: 'Descuento por alimentos (5% renta)', monto: -5425, ivaIncluido: true, grupo: 'renta', ref: { tipo: 'descuentoAlimentos', cantidad: 1, unidad: 'evento', precioUnitario: -5425 } },
      { concepto: 'Mesa de dulces', detalle: '× 250', monto: 27500, ivaIncluido: false, grupo: 'otros', ref: { tipo: 'servicioCatalogo', id: 'a1', cantidad: 250, unidad: 'personas', precioUnitario: 110 } },
      { concepto: 'Tornaboda', monto: 8000, ivaIncluido: true, grupo: 'otros', ref: { tipo: 'servicioEvento', id: '1', cantidad: 1, unidad: 'evento', precioUnitario: 8000 } },
    ];
    const otrosTotal = Math.round((199750 + 27500) * 1.16 + 8000);
    const r = desgloseParaBI(lines, { quoteId: 'q1', ivaRate: IVA, rentaTotal: 103075, otrosTotal });

    expect(r.map((x) => [x.id, x.bloque, x.tipo, x.refId])).toEqual([
      ['q1:rentaSalon:arcos', 'renta', 'rentaSalon', 'arcos'],
      ['q1:descuentoAlimentos', 'renta', 'descuentoAlimentos', null],
      ['q1:alimentos:pkg1', 'otros', 'alimentos', 'pkg1'],
      ['q1:servicioCatalogo:a1', 'otros', 'servicioCatalogo', 'a1'],
      ['q1:servicioEvento:1', 'otros', 'servicioEvento', '1'],
    ]);
    const dulces = r.find((x) => x.tipo === 'servicioCatalogo')!;
    expect(dulces).toMatchObject({ cantidad: 250, unidad: 'personas', precioUnitario: 127.6, subtotal: 27500, total: 31900 });
    expect(r.find((x) => x.tipo === 'servicioEvento')).toMatchObject({ precioUnitario: 8000, total: 8000, subtotal: 6896.55 });
    const suma = (b: string) => r.filter((x) => x.bloque === b).reduce((s, x) => s + x.total, 0);
    expect(suma('renta')).toBe(103075);
    expect(Math.round(suma('otros') * 100) / 100).toBe(otrosTotal);
  });

  it('los cargos del punto de venta llevan su id de cargo y origen puntoDeVenta', () => {
    const r = desgloseParaBI(
      [{ concepto: 'Hora extra de salón', monto: 10850, ivaIncluido: true, grupo: 'renta', cargoId: 'c9', ref: { tipo: 'cargoContrato', id: 'horaExtra', cantidad: 2, unidad: 'horas', precioUnitario: 5425 } }],
      { quoteId: 'q1', ivaRate: IVA, rentaTotal: 10850, otrosTotal: 0 },
    );
    expect(r[0]).toMatchObject({ id: 'q1:cargo:c9', tipo: 'cargoContrato', refId: 'horaExtra', origen: 'puntoDeVenta', cargoId: 'c9', cantidad: 2 });
  });

  it('un desglose viejo sin ref: salón por spaceId, lo demás como otro', () => {
    const r = desgloseParaBI(
      [
        { concepto: 'Renta Cúpula', monto: 90000, ivaIncluido: true, grupo: 'renta', spaceId: 'cupula' },
        { concepto: 'Mesa de dulces', monto: 1000, ivaIncluido: false, grupo: 'otros' },
      ],
      { quoteId: 'q2', ivaRate: IVA, rentaTotal: 90000, otrosTotal: 1160 },
    );
    expect(r.map((x) => [x.id, x.tipo, x.cantidad])).toEqual([
      ['q2:rentaSalon:cupula', 'rentaSalon', 1],
      ['q2:otro:2', 'otro', 1],
    ]);
  });

  it('el mismo servicio dos veces no repite id', () => {
    const l: QuoteLine = { concepto: 'Letras', monto: 900, ivaIncluido: false, grupo: 'otros', ref: { tipo: 'servicioCatalogo', id: 'a1', cantidad: 1, unidad: 'unidades', precioUnitario: 900 } };
    const r = desgloseParaBI([l, l], { quoteId: 'q', ivaRate: IVA, rentaTotal: 0, otrosTotal: 2088 });
    expect(r.map((x) => x.id)).toEqual(['q:servicioCatalogo:a1', 'q:servicioCatalogo:a1:2']);
  });

  it('el último renglón del bloque absorbe los centavos', () => {
    const l: QuoteLine = { concepto: 'Barra', monto: 333.33, ivaIncluido: false, grupo: 'otros', ref: { tipo: 'servicioCatalogo', id: 'b', cantidad: 1, unidad: 'evento', precioUnitario: 333.33 } };
    const r = desgloseParaBI([l, { ...l, ref: { ...l.ref!, id: 'c' } }], { quoteId: 'q', ivaRate: IVA, rentaTotal: 0, otrosTotal: 773 });
    expect(r[0]!.total).toBe(386.66);
    expect(r[1]!.total).toBe(386.34);
  });

  it('un evento importado: renta por salón y un renglón pactado', () => {
    const b = desgloseImportado({ salones: [{ spaceId: 'arcos', nombre: 'Arcos' }], rentaTotal: 100000, otrosTotal: 50000, ivaRate: IVA });
    const r = desgloseParaBI(b.lines, { quoteId: 'q', ivaRate: IVA, rentaTotal: 100000, otrosTotal: 50000 });
    expect(r.map((x) => [x.tipo, x.total])).toEqual([
      ['rentaSalon', 100000],
      ['pactado', 50000],
    ]);
  });
});
