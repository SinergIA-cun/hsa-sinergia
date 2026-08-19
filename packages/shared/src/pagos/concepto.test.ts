import { describe, it, expect } from 'vitest';
import { deducirConcepto, deducirConceptos, type HitosPago, type PagoParaConcepto } from './concepto.js';

// Arcos, 250 pax, sábado: renta 108,500. Anticipo 20,000 y complemento 50% de la
// renta ⇒ objetivo acumulado del complemento 20,000 + 54,250 = 74,250.
const HITOS: HitosPago = { apartar: 20000, complemento: 74250, finiquito: 108500 };

/** Un pago vivo, con el concepto que sea (el capturado da igual si hay plan). */
function pago(id: string, monto: number, extra: Partial<PagoParaConcepto> = {}): PagoParaConcepto {
  return { id, monto, anuladoAt: null, concepto: 'aCuenta', ...extra };
}

describe('deducirConcepto (un pago suelto)', () => {
  it('el que cruza el objetivo del apartado es el anticipo', () => {
    expect(deducirConcepto(0, 20000, HITOS)).toBe('anticipo');
  });

  it('el que cruza el del complemento es el complemento', () => {
    expect(deducirConcepto(20000, 54250, HITOS)).toBe('complemento');
  });

  it('el que lleva el pagado a cubrir el total es el finiquito', () => {
    expect(deducirConcepto(74250, 34250, HITOS)).toBe('finiquito');
  });

  it('uno intermedio que no cruza ningún hito es a cuenta', () => {
    expect(deducirConcepto(20000, 5000, HITOS)).toBe('aCuenta');
  });

  it('un pago que se pasa del total sigue siendo finiquito', () => {
    expect(deducirConcepto(0, 500000, HITOS)).toBe('finiquito');
  });

  it('el pago que cruza VARIOS hitos de un jalón se queda con el más alto', () => {
    // 80,000 cruza el anticipo Y el complemento, pero no el finiquito.
    expect(deducirConcepto(0, 80000, HITOS)).toBe('complemento');
  });

  it('un hito ya cubierto no se vuelve a cruzar', () => {
    // El anticipo ya está cubierto: este pago no lo "cruza" otra vez.
    expect(deducirConcepto(25000, 1000, HITOS)).toBe('aCuenta');
  });
});

describe('deducirConceptos (la secuencia completa)', () => {
  it('la secuencia típica sale sola: anticipo, complemento, finiquito', () => {
    const r = deducirConceptos(
      [pago('a', 20000), pago('b', 54250), pago('c', 34250)],
      HITOS,
    );
    expect([r.get('a'), r.get('b'), r.get('c')]).toEqual(['anticipo', 'complemento', 'finiquito']);
  });

  it('un abono intermedio queda como a cuenta sin mover a los demás', () => {
    const r = deducirConceptos(
      [pago('a', 20000), pago('abono', 5000), pago('b', 49250), pago('c', 34250)],
      HITOS,
    );
    expect(r.get('abono')).toBe('aCuenta');
    expect(r.get('b')).toBe('complemento');
    expect(r.get('c')).toBe('finiquito');
  });

  it('el pago que cierra la cuenta es finiquito AUNQUE lo capturaran como otra cosa', () => {
    const r = deducirConceptos(
      [pago('a', 20000), pago('b', 88500, { concepto: 'aCuenta', conceptoManual: 'aCuenta' })],
      HITOS,
    );
    expect(r.get('b')).toBe('finiquito');
  });

  it('marcar "finiquito" a mano no lo hace finiquito si no cierra la cuenta', () => {
    // La etiqueta del finiquito la manda el saldo, en los dos sentidos.
    const r = deducirConceptos([pago('a', 20000, { conceptoManual: 'finiquito' })], HITOS);
    expect(r.get('a')).toBe('anticipo');
  });

  it('un ajuste a mano SÍ se respeta en los conceptos que no son el finiquito', () => {
    const r = deducirConceptos([pago('a', 20000, { conceptoManual: 'aCuenta' })], HITOS);
    expect(r.get('a')).toBe('aCuenta');
  });

  it('los pagos anulados no cuentan para el acumulado', () => {
    const r = deducirConceptos(
      [
        pago('anulado', 20000, { anuladoAt: new Date('2027-02-01'), concepto: 'anticipo' }),
        pago('bueno', 20000),
      ],
      HITOS,
    );
    // El anulado conserva su etiqueta (es evidencia), y el siguiente sí es el anticipo.
    expect(r.get('anulado')).toBe('anticipo');
    expect(r.get('bueno')).toBe('anticipo');
  });

  it('anular el pago de en medio degrada al que era finiquito', () => {
    const pagos = [pago('a', 20000), pago('b', 54250), pago('c', 34250)];
    expect(deducirConceptos(pagos, HITOS).get('c')).toBe('finiquito');

    const sinB = [pagos[0]!, { ...pagos[1]!, anuladoAt: new Date('2027-03-01') }, pagos[2]!];
    const r = deducirConceptos(sinB, HITOS);
    // Sin el complemento, 20,000 + 34,250 = 54,250: ya no cierra nada.
    expect(r.get('c')).toBe('aCuenta');
  });

  it('sin plan de pagos respeta lo capturado y no inventa', () => {
    const r = deducirConceptos(
      [pago('a', 20000, { concepto: 'anticipo' }), pago('b', 999999, { concepto: 'aCuenta' })],
      null,
    );
    expect(r.get('a')).toBe('anticipo');
    // 999,999 cerraría cualquier cuenta, pero sin hitos no hay nada que cerrar.
    expect(r.get('b')).toBe('aCuenta');
  });

  it('sin plan de pagos, el ajuste a mano manda sobre lo guardado', () => {
    const r = deducirConceptos(
      [pago('a', 20000, { concepto: 'anticipo', conceptoManual: 'aCuenta' })],
      null,
    );
    expect(r.get('a')).toBe('aCuenta');
  });

  it('sin pagos devuelve un mapa vacío', () => {
    expect(deducirConceptos([], HITOS).size).toBe(0);
  });
});
