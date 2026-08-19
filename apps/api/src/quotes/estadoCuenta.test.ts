import { describe, it, expect } from 'vitest';
import { computeEstadoCuenta, type SpaceRule } from './estadoCuenta.js';

const ARCOS: SpaceRule = { anticipo: 20000, complementoPct: 0.1, liquidarDiasAntes: 30 };
const CAMPOS: SpaceRule = { anticipo: 15000, complementoPct: 0.15, liquidarDiasAntes: 30 };

// Un solo espacio: se lleva toda la renta, así que su base ES el total. El
// servicio garantiza esa invariante prorrateando antes de llamar al motor:
// `Σ rentaBase == total` siempre.
const soloArcos = [{ spaceId: 'arcos', rule: ARCOS, rentaBase: 100000 }];

const base = {
  total: 100000,
  fechaEvento: new Date('2027-05-08T00:00:00.000Z'),
  status: 'borrador' as const,
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
    expect(plan.find((m) => m.key === 'complemento')!.desglose).toEqual([
      { spaceId: 'arcos', rentaBase: 100000, pct: 0.1, monto: 10000 },
    ]);
    expect(plan.find((m) => m.key === 'finiquito')!.objetivo).toBe(100000);
  });

  it('dos espacios: el anticipo suma y el complemento se reparte en proporción a la renta', () => {
    // Arcos aporta 60,000 de renta y Campos 40,000 (total 100,000).
    // Anticipo = 20,000 + 15,000 = 35,000.
    // Complemento = 10%×60,000 + 15%×40,000 = 6,000 + 6,000 = 12,000.
    // Idéntico al viejo ponderado (12% de 100,000). Total = 35,000 + 12,000 = 47,000.
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
    expect(plan.find((m) => m.key === 'complemento')!.desglose).toEqual([
      { spaceId: 'arcos', rentaBase: 60000, pct: 0.1, monto: 6000 },
      { spaceId: 'campos', rentaBase: 40000, pct: 0.15, monto: 6000 },
    ]);
    expect(plan.find((m) => m.key === 'finiquito')!.objetivo).toBe(100000);
  });

  it('la ponderación fraccionaria da el mismo complemento que la fórmula vieja', () => {
    // Cúpula 25% con 70,000 de catálogo + Arcos 10% con 30,000: ponderado 20.5%.
    // Con 120,000 de renta total (horas extra incluidas) el servicio prorratea a
    // 84,000 y 36,000. La suma de los renglones tiene que dar lo mismo que el
    // viejo `20.5% × 120,000`.
    const ec = computeEstadoCuenta({
      ...base,
      total: 120000,
      rules: [
        { spaceId: 'cupula', rule: { anticipo: 25000, complementoPct: 0.25, liquidarDiasAntes: 30 }, rentaBase: 84000 },
        { spaceId: 'arcos', rule: { anticipo: 20000, complementoPct: 0.1, liquidarDiasAntes: 30 }, rentaBase: 36000 },
      ],
      payments: [],
    });
    const comp = ec.plan!.find((m) => m.key === 'complemento')!;
    // 25% × 84,000 = 21,000 ; 10% × 36,000 = 3,600 → 24,600 = 20.5% × 120,000.
    expect(comp.desglose).toEqual([
      { spaceId: 'cupula', rentaBase: 84000, pct: 0.25, monto: 21000 },
      { spaceId: 'arcos', rentaBase: 36000, pct: 0.1, monto: 3600 },
    ]);
    // 45,000 de anticipos + 24,600 = 69,600 — idéntico a antes del Plan D.
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

describe('complemento por salón', () => {
  const reglas = [
    { spaceId: 'cup', rentaBase: 184_778.76, rule: { anticipo: 25_000, complementoPct: 0.25, liquidarDiasAntes: 30 } },
    { spaceId: 'arc', rentaBase: 115_221.24, rule: { anticipo: 20_000, complementoPct: 0.10, liquidarDiasAntes: 30 } },
  ];

  it('el complemento es la suma exacta de cada salón', () => {
    const ec = computeEstadoCuenta({
      total: 300_000,
      fechaEvento: new Date('2027-05-01T00:00:00Z'),
      status: 'borrador',
      rules: reglas,
      payments: [],
    });
    const comp = ec.plan!.find((h) => h.key === 'complemento')!;
    // 25% × 184,778.76 = 46,194.69 ; 10% × 115,221.24 = 11,522.12
    expect(comp.desglose).toEqual([
      { spaceId: 'cup', rentaBase: 184_778.76, pct: 0.25, monto: 46_195 },
      { spaceId: 'arc', rentaBase: 115_221.24, pct: 0.10, monto: 11_522 },
    ]);
    // objetivo = apartado (45,000) + 46,195 + 11,522
    expect(comp.objetivo).toBe(102_717);
  });

  it('con un solo salón el desglose tiene un renglón que multiplica exacto', () => {
    const ec = computeEstadoCuenta({
      total: 196_400,
      fechaEvento: new Date('2027-05-01T00:00:00Z'),
      status: 'borrador',
      rules: [{ spaceId: 'cup', rentaBase: 196_400, rule: { anticipo: 25_000, complementoPct: 0.25, liquidarDiasAntes: 30 } }],
      payments: [],
    });
    const comp = ec.plan!.find((h) => h.key === 'complemento')!;
    expect(comp.desglose).toEqual([{ spaceId: 'cup', rentaBase: 196_400, pct: 0.25, monto: 49_100 }]);
    expect(comp.objetivo).toBe(74_100); // 25,000 + 49,100
  });
});

describe('el plan nunca pide más de lo que cuesta el evento', () => {
  it('con cortesía del 100% no se cobra apartado: los tres hitos van en cero', () => {
    // La renta se fue a cero por el descuento, pero `anticipo` es un monto FIJO
    // del catálogo y no sabe del descuento. Sin tope, el apartado pedía $20,000
    // de un evento que no cuesta nada, y el finiquito pedía $0 — o sea que los
    // hitos dejaban de ser una escalera y el saldo salía negativo.
    const ec = computeEstadoCuenta({
      ...base,
      total: 0,
      rules: [{ spaceId: 'arcos', rule: ARCOS, rentaBase: 0 }],
      payments: [],
    });
    for (const key of ['apartar', 'complemento', 'finiquito'] as const) {
      expect(ec.plan!.find((m) => m.key === key)!.objetivo).toBe(0);
    }
    expect(ec.saldo).toBe(0);
  });

  it('un descuento parcial topa el apartado al total, no al anticipo fijo', () => {
    // 90% de descuento: la renta queda en 10,000 y el anticipo fijo es 20,000.
    const ec = computeEstadoCuenta({
      ...base,
      total: 10000,
      rules: [{ spaceId: 'arcos', rule: ARCOS, rentaBase: 10000 }],
      payments: [],
    });
    expect(ec.plan!.find((m) => m.key === 'apartar')!.objetivo).toBe(10000);
    expect(ec.plan!.find((m) => m.key === 'complemento')!.objetivo).toBe(10000);
    expect(ec.plan!.find((m) => m.key === 'finiquito')!.objetivo).toBe(10000);
  });

  it('los hitos siempre van en escalera: apartar ≤ complemento ≤ finiquito', () => {
    for (const total of [0, 1, 5000, 20000, 25000, 30000, 100000]) {
      const ec = computeEstadoCuenta({
        ...base,
        total,
        rules: [{ spaceId: 'arcos', rule: ARCOS, rentaBase: total }],
        payments: [],
      });
      const obj = (k: 'apartar' | 'complemento' | 'finiquito'): number =>
        ec.plan!.find((m) => m.key === k)!.objetivo;
      expect(obj('apartar')).toBeLessThanOrEqual(obj('complemento'));
      expect(obj('complemento')).toBeLessThanOrEqual(obj('finiquito'));
      expect(obj('finiquito')).toBe(total);
    }
  });

  it('sin descuento el plan no se mueve (el tope no muerde)', () => {
    const ec = computeEstadoCuenta({ ...base, rules: soloArcos, payments: [] });
    expect(ec.plan!.find((m) => m.key === 'apartar')!.objetivo).toBe(20000);
    expect(ec.plan!.find((m) => m.key === 'complemento')!.objetivo).toBe(30000);
    expect(ec.plan!.find((m) => m.key === 'finiquito')!.objetivo).toBe(100000);
  });

  it('un evento gratis ya pagado queda a favor, no en desfase', () => {
    // Se cobró el apartado y DESPUÉS se aplicó la cortesía: hay dinero de más.
    const ec = computeEstadoCuenta({
      ...base,
      total: 0,
      rules: [{ spaceId: 'arcos', rule: ARCOS, rentaBase: 0 }],
      payments: [{ monto: 25000, anuladoAt: null }],
      status: 'formalizada' as const,
    });
    expect(ec.saldo).toBe(-25000); // negativo = a favor del cliente
    expect(ec.desfase).toBe(false); // no es un desfase: pagó de más, no de menos
    expect(ec.sugerido).toBe('liquidada');
  });
});

describe('el desglose del apartado cuadra con su total', () => {
  const dos = [
    { spaceId: 'arcos', rule: ARCOS, rentaBase: 60000 },
    { spaceId: 'campos', rule: CAMPOS, rentaBase: 40000 },
  ];

  it('sin tope, cada salón muestra su propio anticipo', () => {
    const ec = computeEstadoCuenta({ ...base, rules: dos, payments: [] });
    const ap = ec.plan!.find((m) => m.key === 'apartar')!;
    expect(ap.desglose).toEqual([
      { spaceId: 'arcos', monto: 20000 },
      { spaceId: 'campos', monto: 15000 },
    ]);
    expect(ap.desglose!.reduce((s, d) => s + d.monto, 0)).toBe(ap.objetivo);
  });

  it('con el tope mordiendo, el desglose se reparte y SIGUE sumando el total', () => {
    // El contrato imprime un renglón por salón y un total. Si los renglones
    // salen del catálogo y el total del hito topado, el documento firmado se
    // contradice solo — es el mismo defecto que ya costó la Capilla.
    const ec = computeEstadoCuenta({
      ...base,
      total: 14000,
      rules: [
        { spaceId: 'arcos', rule: ARCOS, rentaBase: 8400 },
        { spaceId: 'campos', rule: CAMPOS, rentaBase: 5600 },
      ],
      payments: [],
    });
    const ap = ec.plan!.find((m) => m.key === 'apartar')!;
    expect(ap.objetivo).toBe(14000);
    expect(ap.desglose!.reduce((s, d) => s + d.monto, 0)).toBe(14000);
  });

  it('con cortesía del 100% el desglose va en ceros, no en montos del catálogo', () => {
    const ec = computeEstadoCuenta({
      ...base,
      total: 0,
      rules: [
        { spaceId: 'arcos', rule: ARCOS, rentaBase: 0 },
        { spaceId: 'campos', rule: CAMPOS, rentaBase: 0 },
      ],
      payments: [],
    });
    const ap = ec.plan!.find((m) => m.key === 'apartar')!;
    expect(ap.desglose).toEqual([
      { spaceId: 'arcos', monto: 0 },
      { spaceId: 'campos', monto: 0 },
    ]);
  });
});
