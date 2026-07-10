import { describe, it, expect } from 'vitest';
import { computeEstadoCuenta, type SpaceRule } from './estadoCuenta.js';

const rule: SpaceRule = { anticipo: 20000, complementoPct: 0.1, liquidarDiasAntes: 30 };
const base = {
  total: 100000,
  fechaEvento: new Date('2027-05-08T00:00:00.000Z'),
  status: 'aceptada' as const,
  now: new Date('2027-01-01T00:00:00.000Z'),
};

describe('computeEstadoCuenta', () => {
  it('sin regla: plan pendiente, sin sugerencia', () => {
    const ec = computeEstadoCuenta({ ...base, rule: null, payments: [] });
    expect(ec.plan).toBeNull();
    expect(ec.planPendiente).toBe(true);
    expect(ec.sugerido).toBeNull();
    expect(ec.saldo).toBe(100000);
  });

  it('pagado excluye anulados', () => {
    const ec = computeEstadoCuenta({
      ...base, rule,
      payments: [{ monto: 20000, anuladoAt: null }, { monto: 5000, anuladoAt: new Date() }],
    });
    expect(ec.pagado).toBe(20000);
    expect(ec.saldo).toBe(80000);
  });

  it('umbrales: anticipo→apartada, +complemento→formalizada, total→liquidada', () => {
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 20000, anuladoAt: null }] }).sugerido).toBe('apartada');
    // anticipo 20000 + 10% de 100000 = 30000
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 30000, anuladoAt: null }] }).sugerido).toBe('formalizada');
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 100000, anuladoAt: null }] }).sugerido).toBe('liquidada');
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 1000, anuladoAt: null }] }).sugerido).toBeNull();
  });

  it('desfase: estatus formalizada pero pagado no cubre el complemento', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'formalizada', rule, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(true);
  });

  it('no hay desfase cuando el pagado cubre el estatus', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'apartada', rule, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(false);
  });
});
