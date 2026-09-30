import { describe, it, expect } from 'vitest';
import { rentaBaseDeDesglose, precioHoraExtra, saldoDeCargos } from './productos.js';

const desglose = {
  lines: [
    { concepto: 'Renta sp1', monto: 108_500, grupo: 'renta', spaceId: 'sp1' },
    { concepto: 'Descuento de cortesía (10% renta)', monto: -10_850, grupo: 'renta' },
    { concepto: 'Horas extra', monto: 9_765, grupo: 'renta' },
    { concepto: 'Capilla', monto: 5_000, grupo: 'renta' },
    { concepto: 'Menú', monto: 80_000, grupo: 'otros' },
  ],
};

describe('rentaBaseDeDesglose', () => {
  it('es la renta de los espacios menos el descuento; sin horas extra, capilla ni alimentos', () => {
    expect(rentaBaseDeDesglose(desglose)).toBe(97_650);
  });
  it('con varios salones suma cada uno', () => {
    expect(
      rentaBaseDeDesglose({
        lines: [
          { concepto: 'Renta a', monto: 100, grupo: 'renta', spaceId: 'a' },
          { concepto: 'Renta b', monto: 50, grupo: 'renta', spaceId: 'b' },
        ],
      }),
    ).toBe(150);
  });
  it('un desglose sin renglones da cero, no revienta', () => {
    expect(rentaBaseDeDesglose(null)).toBe(0);
    expect(rentaBaseDeDesglose({})).toBe(0);
  });
});

describe('precioHoraExtra', () => {
  it('5% de la renta, redondeado a pesos', () => {
    expect(precioHoraExtra(108_500, 0.05)).toBe(5_425);
    expect(precioHoraExtra(97_650, 0.05)).toBe(4_883);
  });
});

describe('saldoDeCargos', () => {
  it('los anulados no cuentan ni como cargo ni como pago', () => {
    expect(
      saldoDeCargos(
        [
          { total: 10_000, anuladoAt: null },
          { total: 3_000, anuladoAt: new Date() },
        ],
        [
          { monto: 4_000, anuladoAt: null },
          { monto: 6_000, anuladoAt: new Date() },
        ],
      ),
    ).toEqual({ total: 10_000, pagado: 4_000, saldo: 6_000 });
  });
});
