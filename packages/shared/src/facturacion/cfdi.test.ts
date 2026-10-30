import { describe, it, expect } from 'vitest';
import { cfdiDePago, desglosarIva, formaPagoSat, informacionGlobalDiaria, partesFacturables, receptorPublicoGeneral } from './cfdi.js';

const emisor = { rfc: 'GOYA780416GM0', nombre: 'EMPRESA DEMOSTRACION', regimenFiscal: '612', codigoPostal: '77500' };
const receptor = { rfc: 'EKU9003173C9', nombre: 'ESCUELA KEMPER URGATE', regimenFiscal: '601', codigoPostal: '06370', usoCfdi: 'G03' };
const concepto = { claveProdServ: '01010101', claveUnidad: 'E48', descripcion: 'Anticipo de renta' };

describe('CFDI de un pago', () => {
  it('parte el monto con IVA en base e IVA sin perder centavos', () => {
    expect(desglosarIva(1_000, 0.16)).toEqual({ base: 862.07, iva: 137.93 });
    expect(desglosarIva(108_500, 0.16)).toEqual({ base: 93_534.48, iva: 14_965.52 });
    for (const m of [1, 99, 1234, 55_555, 333_333]) {
      const { base, iva } = desglosarIva(m, 0.16);
      expect(Math.round((base + iva) * 100) / 100).toBe(m);
    }
  });

  it('la forma de pago es la de la parte más grande', () => {
    expect(formaPagoSat([{ forma: 'transferencia', monto: 1000 }])).toBe('03');
    expect(formaPagoSat([{ forma: 'tarjetaDebito', monto: 4000 }, { forma: 'tarjetaCredito', monto: 6000 }])).toBe('04');
    expect(formaPagoSat([{ forma: 'efectivo', monto: 7000 }, { forma: 'tarjetaDebito', monto: 3000 }])).toBe('01');
    expect(formaPagoSat([{ forma: 'desconocida', monto: 1 }])).toBe('99');
  });

  it('arma el JSON de Facturador: ingreso PUE con IVA trasladado y totales que cuadran', () => {
    const c = cfdiDePago({ emisor, receptor, concepto, montoConIva: 1_000, partes: [{ forma: 'efectivo', monto: 1_000 }], fecha: '2026-10-12T10:30:00', ivaRate: 0.16, serie: 'Sin Serie' });
    expect(c).toMatchObject({
      version: '4.0',
      tipoDeComprobante: 'I',
      metodoPago: 'PUE',
      formaPago: '01',
      moneda: 'MXN',
      lugarExpedicion: '77500',
      subTotal: 862.07,
      total: 1000,
      receptor: { rfc: 'EKU9003173C9', usoCFDI: 'G03', regimenFiscalReceptor: '601', domicilioFiscalReceptor: '06370' },
      impuestos: { totalImpuestosTrasladados: 137.93 },
    });
    expect(c.conceptos[0]).toMatchObject({ cantidad: 1, valorUnitario: 862.07, importe: 862.07, objetoImp: '02' });
    expect(c.conceptos[0]!.impuestos.traslados[0]).toEqual({ base: 862.07, impuesto: '002', tipoFactor: 'Tasa', tasaOCuota: 0.16, importe: 137.93 });
    expect(c.serie).toBe('Sin Serie');
    expect(c).not.toHaveProperty('serieId');
  });
});

describe('público en general y partes facturables', () => {
  it('el efectivo no se factura: de un pago mixto solo las demás partes', () => {
    const r = partesFacturables([
      { forma: 'efectivo', monto: 4_000 },
      { forma: 'transferencia', monto: 6_000 },
      { forma: 'tarjetaDebito', monto: 500.5 },
    ]);
    expect(r.monto).toBe(6_500.5);
    expect(r.partes.map((p) => p.forma)).toEqual(['transferencia', 'tarjetaDebito']);
    expect(partesFacturables([{ forma: 'efectivo', monto: 1_000 }]).monto).toBe(0);
  });

  it('a público en general lleva el RFC genérico, régimen 616, uso S01 y la información global del día', () => {
    const receptor = receptorPublicoGeneral('53000');
    expect(receptor).toEqual({ rfc: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL', regimenFiscal: '616', codigoPostal: '53000', usoCfdi: 'S01' });
    const c = cfdiDePago({
      emisor: { rfc: 'AAA010101AAA', nombre: 'EMISOR', regimenFiscal: '601', codigoPostal: '53000' },
      receptor,
      concepto: { claveProdServ: '01010101', claveUnidad: 'E48', descripcion: 'Renta' },
      montoConIva: 1_160,
      partes: [{ forma: 'transferencia', monto: 1_160 }],
      fecha: '2026-10-30T10:00:00',
      ivaRate: 0.16,
      serie: 'A',
      informacionGlobal: informacionGlobalDiaria('2026-10-30T10:00:00'),
    });
    expect(c.informacionGlobal).toEqual({ periodicidad: '01', meses: '10', año: '2026' });
    expect(c.receptor).toMatchObject({ rfc: 'XAXX010101000', usoCFDI: 'S01', regimenFiscalReceptor: '616', domicilioFiscalReceptor: '53000' });
  });
});

