import { describe, it, expect } from 'vitest';
import { deducirConcepto, deducirConceptos, type PagoParaConcepto, type PaymentConcept } from './concepto.js';

/**
 * La regla del BI (decisión del dueño, 5-oct-2026): primero `anticipo`, el que
 * completa el contrato con tolerancia de $1,000 es `finiquito`, los demás
 * `aCuenta`. Sin `complemento`.
 */

const pago = (id: string, monto: number, extra: Partial<PagoParaConcepto> = {}): PagoParaConcepto => ({
  id,
  monto,
  anuladoAt: null,
  concepto: 'aCuenta' as PaymentConcept,
  ...extra,
});

describe('deducirConcepto', () => {
  it('el primero es anticipo; el que completa es finiquito; los demás a cuenta', () => {
    expect(deducirConcepto(0, 20_000, 100_000, true)).toBe('anticipo');
    expect(deducirConcepto(20_000, 30_000, 100_000, false)).toBe('aCuenta');
    expect(deducirConcepto(50_000, 50_000, 100_000, false)).toBe('finiquito');
  });

  it('tolerancia de $1,000: el que deja $1,000 o menos por pagar es finiquito; si falta más, no', () => {
    expect(deducirConcepto(50_000, 49_000, 100_000, false)).toBe('finiquito');
    expect(deducirConcepto(50_000, 48_999, 100_000, false)).toBe('aCuenta');
  });

  it('un solo pago que cubre todo es finiquito, no anticipo', () => {
    expect(deducirConcepto(0, 100_000, 100_000, true)).toBe('finiquito');
  });
});

describe('deducirConceptos', () => {
  it('la secuencia: anticipo, a cuenta, finiquito, y lo que llega después es a cuenta', () => {
    const r = deducirConceptos([pago('a', 20_000), pago('b', 30_000), pago('c', 50_000), pago('d', 500)], 100_000);
    expect([r.get('a'), r.get('b'), r.get('c'), r.get('d')]).toEqual(['anticipo', 'aCuenta', 'finiquito', 'aCuenta']);
  });

  it('nunca deduce complemento, aunque esté guardado o capturado así', () => {
    const r = deducirConceptos(
      [pago('a', 20_000, { concepto: 'complemento' }), pago('b', 30_000, { conceptoManual: 'complemento' })],
      100_000,
    );
    expect([r.get('a'), r.get('b')]).toEqual(['anticipo', 'aCuenta']);
  });

  it('el finiquito lo dicta el saldo en los dos sentidos', () => {
    const marcado = deducirConceptos([pago('a', 20_000, { conceptoManual: 'finiquito' })], 100_000);
    expect(marcado.get('a')).toBe('anticipo');
    const cierra = deducirConceptos([pago('a', 20_000), pago('b', 80_000, { conceptoManual: 'aCuenta' })], 100_000);
    expect(cierra.get('b')).toBe('finiquito');
  });

  it('un ajuste a mano se respeta si no es el finiquito', () => {
    const r = deducirConceptos([pago('a', 20_000), pago('b', 10_000, { conceptoManual: 'anticipo' })], 100_000);
    expect(r.get('b')).toBe('anticipo');
  });

  it('los anulados conservan su etiqueta y no cuentan: el siguiente es el anticipo', () => {
    const r = deducirConceptos(
      [pago('x', 20_000, { anuladoAt: new Date(), concepto: 'anticipo' }), pago('a', 20_000)],
      100_000,
    );
    expect([r.get('x'), r.get('a')]).toEqual(['anticipo', 'anticipo']);
  });

  it('anular el de en medio degrada al que era finiquito', () => {
    const r = deducirConceptos(
      [pago('a', 20_000), pago('b', 30_000, { anuladoAt: new Date(), concepto: 'aCuenta' }), pago('c', 50_000)],
      100_000,
    );
    expect(r.get('c')).toBe('aCuenta');
  });

  it('sin precio no se deduce nada: se respeta lo capturado', () => {
    const r = deducirConceptos([pago('a', 20_000, { concepto: 'anticipo' })], null);
    expect(r.get('a')).toBe('anticipo');
  });
});
