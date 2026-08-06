import { describe, it, expect } from 'vitest';
import { requisitosFactura, faltanDatosFactura } from './requisitos.js';

const completo = {
  rfc: 'GODE561231GR8',
  razonSocial: 'Juan Pérez López',
  regimenFiscal: '612',
  cpFiscal: '53100',
  usoCfdi: 'G03',
  correoFacturacion: 'juan@ejemplo.com',
};

describe('requisitosFactura', () => {
  it('un cliente completo no tiene faltantes', () => {
    const r = requisitosFactura(completo);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(faltanDatosFactura(completo)).toBe(false);
  });

  it('un cliente vacío tiene todos los requisitos pendientes', () => {
    const r = requisitosFactura({});
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(faltanDatosFactura({})).toBe(true);
  });

  it('acepta RFC de persona moral (12) y física (13)', () => {
    const moral = requisitosFactura({ ...completo, rfc: 'ABC120101XYZ' });
    expect(moral.find((x) => x.campo === 'rfc')!.ok).toBe(true);
    const fisica = requisitosFactura({ ...completo, rfc: 'GODE561231GR8' });
    expect(fisica.find((x) => x.campo === 'rfc')!.ok).toBe(true);
  });

  it('rechaza un RFC con longitud o forma inválida', () => {
    for (const rfc of ['ABC', 'ABCD1234567890', '1234561231GR8', '']) {
      const r = requisitosFactura({ ...completo, rfc });
      expect(r.find((x) => x.campo === 'rfc')!.ok).toBe(false);
    }
  });

  it('el RFC no distingue mayúsculas ni espacios alrededor', () => {
    const r = requisitosFactura({ ...completo, rfc: '  gode561231gr8 ' });
    expect(r.find((x) => x.campo === 'rfc')!.ok).toBe(true);
  });

  it('el código postal debe tener exactamente 5 dígitos', () => {
    expect(requisitosFactura({ ...completo, cpFiscal: '5310' }).find((x) => x.campo === 'cpFiscal')!.ok).toBe(false);
    expect(requisitosFactura({ ...completo, cpFiscal: '531000' }).find((x) => x.campo === 'cpFiscal')!.ok).toBe(false);
    expect(requisitosFactura({ ...completo, cpFiscal: '53100' }).find((x) => x.campo === 'cpFiscal')!.ok).toBe(true);
  });

  it('el régimen y el uso deben ser claves conocidas del SAT', () => {
    expect(requisitosFactura({ ...completo, regimenFiscal: '999' }).find((x) => x.campo === 'regimenFiscal')!.ok).toBe(false);
    expect(requisitosFactura({ ...completo, usoCfdi: 'ZZ9' }).find((x) => x.campo === 'usoCfdi')!.ok).toBe(false);
  });

  it('el correo de facturación debe tener forma de correo', () => {
    expect(requisitosFactura({ ...completo, correoFacturacion: 'no-es-correo' }).find((x) => x.campo === 'correoFacturacion')!.ok).toBe(false);
  });

  it('cada requisito trae una etiqueta legible', () => {
    for (const r of requisitosFactura({})) {
      // 3 y no 4: "RFC" es una etiqueta legítima y es la sigla que usa el SAT.
      expect(r.label.length).toBeGreaterThanOrEqual(3);
    }
  });
});
