import { describe, it, expect } from 'vitest';
import { computeEstadoCuenta, type SpaceRule } from './estadoCuenta.js';

const ARCOS: SpaceRule = { anticipo: 20000, complementoPct: 0.1, liquidarDiasAntes: 30 };
const CAMPOS: SpaceRule = { anticipo: 15000, complementoPct: 0.15, liquidarDiasAntes: 30 };

// Un solo espacio: la renta base es irrelevante para el resultado porque el peso
// proporcional es 1. Se usa el total para que el caso se lea natural.
const soloArcos = [{ spaceId: 'arcos', rule: ARCOS, rentaBase: 100000 }];

const base = {
  total: 100000,
  fechaEvento: new Date('2027-05-08T00:00:00.000Z'),
  status: 'aceptada' as const,
  now: new Date('2027-01-01T00:00:00.000Z'),
};

describe('computeEstadoCuenta', () => {
  it('sin regla: plan pendiente, sin sugerencia', () => {
    const ec = computeEstadoCuenta({ ...base, rules: null, payments: [] });
    expect(ec.plan).toBeNull();
    expect(ec.planPendiente).toBe(true);
    expect(ec.sugerido).toBeNull();
    expect(ec.saldo).toBe(100000);
  });

  it('pagado excluye anulados', () => {
    const ec = computeEstadoCuenta({
      ...base, rules: soloArcos,
      payments: [{ monto: 20000, anuladoAt: null }, { monto: 5000, anuladoAt: new Date() }],
    });
    expect(ec.pagado).toBe(20000);
    expect(ec.saldo).toBe(80000);
  });

  it('umbrales: anticipo→formalizada, +complemento→complementada, total→liquidada', () => {
    expect(computeEstadoCuenta({ ...base, rules: soloArcos, payments: [{ monto: 20000, anuladoAt: null }] }).sugerido).toBe('formalizada');
    // anticipo 20000 + 10% de 100000 = 30000
    expect(computeEstadoCuenta({ ...base, rules: soloArcos, payments: [{ monto: 30000, anuladoAt: null }] }).sugerido).toBe('complementada');
    expect(computeEstadoCuenta({ ...base, rules: soloArcos, payments: [{ monto: 100000, anuladoAt: null }] }).sugerido).toBe('liquidada');
    expect(computeEstadoCuenta({ ...base, rules: soloArcos, payments: [{ monto: 1000, anuladoAt: null }] }).sugerido).toBeNull();
  });

  it('el hito del complemento no menciona formalizar', () => {
    const ec = computeEstadoCuenta({ ...base, rules: soloArcos, payments: [] });
    const comp = ec.plan!.find((m) => m.key === 'complemento')!;
    expect(comp.label).toBe('Complemento');
    expect(ec.plan!.find((m) => m.key === 'apartar')!.label).toBe('Apartar fecha');
  });

  it('desfase: estatus complementada pero pagado no cubre el complemento', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'complementada', rules: soloArcos, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(true);
  });

  it('no hay desfase cuando el pagado cubre el estatus', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'formalizada', rules: soloArcos, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(false);
  });

  it('complemento nunca vence después del finiquito (evento próximo)', () => {
    // Evento en 30 días; apartado hoy. +3 meses caería DESPUÉS del evento.
    const ec = computeEstadoCuenta({
      total: 100000,
      fechaEvento: new Date('2026-07-18T00:00:00.000Z'),
      status: 'formalizada',
      rules: soloArcos,
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
      rules: soloArcos,
      payments: [{ monto: 20000, anuladoAt: null }],
      fechaApartado: new Date('2027-01-10T00:00:00.000Z'),
    });
    const comp = ec.plan!.find((m) => m.key === 'complemento')!;
    expect(comp.venceISO).toBe('2027-04-10T00:00:00.000Z'); // +3 meses del apartado
  });

  it('un solo espacio da el mismo plan que antes del cambio (regresión)', () => {
    const ec = computeEstadoCuenta({ ...base, rules: soloArcos, payments: [] });
    const plan = ec.plan!;
    // anticipo 20000; complemento = 20000 + 10% de 100000 = 30000; finiquito = total
    expect(plan.find((m) => m.key === 'apartar')!.objetivo).toBe(20000);
    expect(plan.find((m) => m.key === 'complemento')!.objetivo).toBe(30000);
    expect(plan.find((m) => m.key === 'complemento')!.porcentaje).toBe(10);
    expect(plan.find((m) => m.key === 'finiquito')!.objetivo).toBe(100000);
  });

  it('dos espacios: el anticipo suma y el complemento se reparte en proporción a la renta', () => {
    // Arcos aporta 60,000 de renta y Campos 40,000 (total 100,000).
    // Anticipo = 20,000 + 15,000 = 35,000.
    // Porcentaje ponderado = 10%×0.6 + 15%×0.4 = 6% + 6% = 12%.
    // Complemento = 35,000 + 12% de 100,000 = 47,000.
    const ec = computeEstadoCuenta({
      ...base,
      rules: [
        { spaceId: 'arcos', rule: ARCOS, rentaBase: 60000 },
        { spaceId: 'campos', rule: CAMPOS, rentaBase: 40000 },
      ],
      payments: [],
    });
    const plan = ec.plan!;
    expect(plan.find((m) => m.key === 'apartar')!.objetivo).toBe(35000);
    expect(plan.find((m) => m.key === 'complemento')!.objetivo).toBe(47000);
    expect(plan.find((m) => m.key === 'complemento')!.porcentaje).toBe(12);
    expect(plan.find((m) => m.key === 'finiquito')!.objetivo).toBe(100000);
  });

  it('el porcentaje del complemento conserva el decimal cuando la ponderación no es entera', () => {
    // Cúpula 25% con renta 70,000 + Arcos 10% con renta 30,000 = 20.5% ponderado.
    const ec = computeEstadoCuenta({
      ...base,
      total: 120000,
      rules: [
        { spaceId: 'cupula', rule: { anticipo: 25000, complementoPct: 0.25, liquidarDiasAntes: 30 }, rentaBase: 70000 },
        { spaceId: 'arcos', rule: { anticipo: 20000, complementoPct: 0.1, liquidarDiasAntes: 30 }, rentaBase: 30000 },
      ],
      payments: [],
    });
    const comp = ec.plan!.find((m) => m.key === 'complemento')!;
    expect(comp.porcentaje).toBe(20.5);
    // 45,000 de anticipos + 20.5% de 120,000 = 45,000 + 24,600 = 69,600
    expect(comp.objetivo).toBe(69600);
  });

  it('si algún espacio no tiene regla, el plan queda pendiente', () => {
    const ec = computeEstadoCuenta({ ...base, rules: null, payments: [] });
    expect(ec.planPendiente).toBe(true);
    expect(ec.plan).toBeNull();
  });

  it('liquidarDiasAntes toma el máximo de los espacios', () => {
    const ec = computeEstadoCuenta({
      ...base,
      rules: [
        { spaceId: 'a', rule: { anticipo: 1000, complementoPct: 0.1, liquidarDiasAntes: 30 }, rentaBase: 50000 },
        { spaceId: 'b', rule: { anticipo: 1000, complementoPct: 0.1, liquidarDiasAntes: 45 }, rentaBase: 50000 },
      ],
      payments: [],
    });
    // Evento 2027-05-08 menos 45 días = 2027-03-24.
    expect(ec.plan!.find((m) => m.key === 'finiquito')!.venceISO).toContain('2027-03-24');
  });
});
