import { describe, it, expect } from 'vitest';
import { calcularCancelacion, pendientePorDevolver, sueltaLaFecha } from './ciclo.js';

describe('cancelación', () => {
  it('100% devuelve todo; 0% retiene todo', () => {
    expect(calcularCancelacion(45_000, 100)).toEqual({ pagado: 45_000, porcentaje: 100, devolver: 45_000, retenido: 0 });
    expect(calcularCancelacion(45_000, 0)).toEqual({ pagado: 45_000, porcentaje: 0, devolver: 0, retenido: 45_000 });
  });

  it('un porcentaje cualquiera redondea al peso y cuadra exacto', () => {
    const c = calcularCancelacion(33_333, 35);
    expect(c.devolver).toBe(11_667);
    expect(c.devolver + c.retenido).toBe(33_333);
  });

  it('fuera de 0..100 no es una decisión', () => {
    expect(() => calcularCancelacion(1_000, -1)).toThrow();
    expect(() => calcularCancelacion(1_000, 101)).toThrow();
    expect(() => calcularCancelacion(1_000, Number.NaN)).toThrow();
  });

  it('sin pagos no hay nada que devolver', () => {
    expect(calcularCancelacion(0, 100)).toMatchObject({ devolver: 0, retenido: 0 });
  });

  it('lo pendiente nunca es negativo', () => {
    expect(pendientePorDevolver(20_000, 5_000)).toBe(15_000);
    expect(pendientePorDevolver(20_000, 25_000)).toBe(0);
  });
});

describe('estatus que sueltan la fecha', () => {
  it('standby y cancelada sí; los demás no', () => {
    expect(sueltaLaFecha('standby')).toBe(true);
    expect(sueltaLaFecha('cancelada')).toBe(true);
    expect(sueltaLaFecha('formalizada')).toBe(false);
    expect(sueltaLaFecha('borrador')).toBe(false);
  });
});
