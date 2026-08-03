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

  it('umbrales: anticipo→formalizada, +complemento→complementada, total→liquidada', () => {
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 20000, anuladoAt: null }] }).sugerido).toBe('formalizada');
    // anticipo 20000 + 10% de 100000 = 30000
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 30000, anuladoAt: null }] }).sugerido).toBe('complementada');
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 100000, anuladoAt: null }] }).sugerido).toBe('liquidada');
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 1000, anuladoAt: null }] }).sugerido).toBeNull();
  });

  it('el hito del complemento no menciona formalizar', () => {
    const ec = computeEstadoCuenta({ ...base, rule, payments: [] });
    const comp = ec.plan!.find((m) => m.key === 'complemento')!;
    expect(comp.label).toBe('Complemento');
    expect(ec.plan!.find((m) => m.key === 'apartar')!.label).toBe('Apartar fecha');
  });

  it('desfase: estatus complementada pero pagado no cubre el complemento', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'complementada', rule, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(true);
  });

  it('no hay desfase cuando el pagado cubre el estatus', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'formalizada', rule, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(false);
  });

  it('complemento nunca vence después del finiquito (evento próximo)', () => {
    // Evento en 30 días; apartado hoy. +3 meses caería DESPUÉS del evento.
    const ec = computeEstadoCuenta({
      total: 100000,
      fechaEvento: new Date('2026-07-18T00:00:00.000Z'),
      status: 'formalizada',
      rule,
      payments: [{ monto: 20000, anuladoAt: null }],
      fechaApartado: new Date('2026-07-01T00:00:00.000Z'),
    });
    const comp = ec.plan!.find((m) => m.key === 'complemento')!;
    const fin = ec.plan!.find((m) => m.key === 'finiquito')!;
    // Finiquito = evento - 30 días = 2026-06-18. El complemento no lo rebasa.
    expect(fin.venceISO).toBe('2026-06-18T00:00:00.000Z');
    expect(new Date(comp.venceISO!).getTime()).toBeLessThanOrEqual(new Date(fin.venceISO!).getTime());
  });

  it('complemento sí usa +3 meses cuando el evento está lejos', () => {
    const ec = computeEstadoCuenta({
      total: 100000,
      fechaEvento: new Date('2027-12-31T00:00:00.000Z'),
      status: 'formalizada',
      rule,
      payments: [{ monto: 20000, anuladoAt: null }],
      fechaApartado: new Date('2027-01-10T00:00:00.000Z'),
    });
    const comp = ec.plan!.find((m) => m.key === 'complemento')!;
    expect(comp.venceISO).toBe('2027-04-10T00:00:00.000Z'); // +3 meses del apartado
  });
});
