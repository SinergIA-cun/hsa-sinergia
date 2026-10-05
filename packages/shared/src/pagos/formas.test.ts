import { describe, it, expect } from 'vitest';
import {
  resolverFormasPago,
  partesDePago,
  describirFormasPago,
  formasPagoSchema,
  formatFolio,
  letraDeAplicacion,
  FormasPagoError,
  formasSinNotas,
} from './formas.js';

describe('resolverFormasPago', () => {
  it('un solo método se vuelve una sola parte', () => {
    expect(resolverFormasPago({ monto: 5000, metodo: 'efectivo' })).toEqual({
      metodo: 'efectivo',
      formas: [{ forma: 'efectivo', monto: 5000 }],
    });
  });

  it('dos tarjetas en un solo pago: el método es mixto y se guardan las dos', () => {
    const formas = [
      { forma: 'tarjetaDebito' as const, monto: 6000 },
      { forma: 'tarjetaCredito' as const, monto: 4000 },
    ];
    expect(resolverFormasPago({ monto: 10000, formas })).toEqual({ metodo: 'mixto', formas });
  });

  it('una sola parte en formas toma su forma como método, no mixto', () => {
    expect(resolverFormasPago({ monto: 800, formas: [{ forma: 'cheque', monto: 800 }] }).metodo).toBe('cheque');
  });

  it('las formas tienen que sumar el monto del pago', () => {
    expect(() =>
      resolverFormasPago({
        monto: 10000,
        formas: [
          { forma: 'efectivo', monto: 6000 },
          { forma: 'transferencia', monto: 3000 },
        ],
      }),
    ).toThrow(FormasPagoError);
  });

  it('el valor viejo tarjeta se conserva sin inventar si fue débito o crédito', () => {
    expect(resolverFormasPago({ monto: 100, metodo: 'tarjeta' })).toEqual({ metodo: 'tarjeta', formas: null });
  });

  it('sin método ni formas es un error', () => {
    expect(() => resolverFormasPago({ monto: 100 })).toThrow(FormasPagoError);
  });
});

describe('formasPagoSchema', () => {

  it('rechaza montos con decimales', () => {
    expect(formasPagoSchema.safeParse([{ forma: 'efectivo', monto: 10.5 }]).success).toBe(false);
  });
});

describe('partesDePago y describirFormasPago', () => {
  it('un pago viejo sin formas es una sola parte con su método', () => {
    expect(partesDePago({ monto: 300, metodo: 'tarjeta', formas: null })).toEqual([{ forma: 'tarjeta', monto: 300 }]);
    expect(describirFormasPago({ monto: 300, metodo: 'tarjeta', formas: null })).toBe('Tarjeta');
  });

  it('un pago dividido se describe parte por parte', () => {
    expect(
      describirFormasPago({
        monto: 10000,
        metodo: 'mixto',
        formas: [
          { forma: 'tarjetaDebito', monto: 6000 },
          { forma: 'tarjetaCredito', monto: 4000 },
        ],
      }),
    ).toBe('Tarjeta de débito $6,000 · Tarjeta de crédito $4,000');
  });
});

describe('formatFolio', () => {
  it('imprime la serie I', () => {
    expect(formatFolio(5332)).toBe('I 5332');
  });
  it('con letra, la aplicación de un depósito repartido', () => {
    expect(formatFolio(5340, 'B')).toBe('I 5340-B');
    expect(formatFolio(5340, null)).toBe('I 5340');
  });
  it('las letras siguen como columnas de Excel', () => {
    expect([0, 1, 2, 25, 26, 27, 51, 52].map(letraDeAplicacion)).toEqual(['A', 'B', 'C', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
  it('los movimientos de antes del folio dicen sin folio', () => {
    expect(formatFolio(null)).toBe('sin folio');
  });
});

describe('notas por parte y formas repetidas', () => {
  it('dos transferencias en el mismo pago, cada una con su banco; una nota en blanco no se guarda', () => {
    const r = formasPagoSchema.parse([
      { forma: 'transferencia', monto: 6_000, nota: '  BBVA ' },
      { forma: 'transferencia', monto: 4_000, nota: '   ' },
    ]);
    expect(r).toEqual([
      { forma: 'transferencia', monto: 6_000, nota: 'BBVA' },
      { forma: 'transferencia', monto: 4_000 },
    ]);
  });

  it('la descripción del pago trae las notas', () => {
    const pago = { monto: 10_000, metodo: 'mixto', formas: [{ forma: 'transferencia', monto: 6_000, nota: 'BBVA' }, { forma: 'efectivo', monto: 4_000 }] };
    expect(describirFormasPago(pago)).toBe('Transferencia $6,000 (BBVA) · Efectivo $4,000');
  });

  it('al cliente le llegan las partes sin notas', () => {
    expect(formasSinNotas([{ forma: 'transferencia', monto: 6_000, nota: 'pagó la tía' }])).toEqual([{ forma: 'transferencia', monto: 6_000 }]);
    expect(formasSinNotas(null)).toBeNull();
  });
});
