import { describe, it, expect } from 'vitest';
import { estadoFacturaPago, datosFiscalesEditables, hoyCivilMexico } from './candado.js';

const HOY = new Date('2026-04-15T12:00:00.000Z');

describe('estadoFacturaPago', () => {
  it('un pago del mes en curso se puede facturar', () => {
    const e = estadoFacturaPago({ fecha: new Date('2026-04-02T00:00:00.000Z') }, HOY);
    expect(e.facturable).toBe(true);
    expect(e.motivo).toBeNull();
  });

  it('el último día del mes todavía se puede facturar', () => {
    const e = estadoFacturaPago({ fecha: new Date('2026-04-30T23:00:00.000Z') }, HOY);
    expect(e.facturable).toBe(true);
  });

  it('un pago de un mes ya cerrado se fue a la global', () => {
    const e = estadoFacturaPago({ fecha: new Date('2026-03-20T00:00:00.000Z') }, HOY);
    expect(e.facturable).toBe(false);
    expect(e.motivo).toMatch(/público en general/i);
    expect(e.motivo).toMatch(/marzo/i);
  });

  it('un pago ya facturado queda cerrado aunque sea del mes en curso', () => {
    const e = estadoFacturaPago(
      { fecha: new Date('2026-04-02T00:00:00.000Z'), facturadoAt: new Date('2026-04-05T00:00:00.000Z') },
      HOY,
    );
    expect(e.facturable).toBe(false);
    expect(e.motivo).toMatch(/ya se factur/i);
  });

  it('un desbloqueo de admin reabre un mes cerrado', () => {
    const e = estadoFacturaPago(
      { fecha: new Date('2026-03-20T00:00:00.000Z'), desbloqueoAt: new Date('2026-04-10T00:00:00.000Z') },
      HOY,
    );
    expect(e.facturable).toBe(true);
    expect(e.motivo).toBeNull();
  });

  it('el desbloqueo NO reabre un pago ya facturado', () => {
    const e = estadoFacturaPago(
      {
        fecha: new Date('2026-03-20T00:00:00.000Z'),
        facturadoAt: new Date('2026-03-25T00:00:00.000Z'),
        desbloqueoAt: new Date('2026-04-10T00:00:00.000Z'),
      },
      HOY,
    );
    expect(e.facturable).toBe(false);
    expect(e.motivo).toMatch(/ya se factur/i);
  });

  it('un pago anulado no cuenta para nada', () => {
    const e = estadoFacturaPago(
      { fecha: new Date('2026-04-02T00:00:00.000Z'), anuladoAt: new Date('2026-04-03T00:00:00.000Z') },
      HOY,
    );
    expect(e.facturable).toBe(false);
    expect(e.motivo).toMatch(/anulado/i);
  });
});

describe('datosFiscalesEditables', () => {
  const hoy = new Date(Date.UTC(2026, 7, 7));

  it('sin pagos, editables', () => {
    expect(datosFiscalesEditables([]).editable).toBe(true);
  });

  it('con pagos pero ninguno facturado, editables', () => {
    const pagos = [{ fecha: new Date(Date.UTC(2026, 2, 10)) }];
    expect(datosFiscalesEditables(pagos).editable).toBe(true);
  });

  it('un mes cerrado SIN factura ya no congela los datos', () => {
    // Marzo cerró y el pago se fue a público en general: el pago no es
    // facturable, pero los datos del cliente siguen siendo suyos y editables.
    const pagos = [{ fecha: new Date(Date.UTC(2026, 2, 10)) }];
    expect(estadoFacturaPago(pagos[0]!, hoy).facturable).toBe(false);
    expect(datosFiscalesEditables(pagos).editable).toBe(true);
  });

  it('una sola factura emitida congela los datos', () => {
    const pagos = [
      { fecha: new Date(Date.UTC(2026, 6, 10)), facturadoAt: new Date(Date.UTC(2026, 6, 11)) },
      { fecha: new Date(Date.UTC(2026, 7, 1)) },
    ];
    const r = datosFiscalesEditables(pagos);
    expect(r.editable).toBe(false);
    expect(r.motivo).toContain('factura');
  });

  it('una factura de un pago anulado no congela nada', () => {
    const pagos = [{
      fecha: new Date(Date.UTC(2026, 6, 10)),
      facturadoAt: new Date(Date.UTC(2026, 6, 11)),
      anuladoAt: new Date(Date.UTC(2026, 6, 20)),
    }];
    expect(datosFiscalesEditables(pagos).editable).toBe(true);
  });
});

describe('hoyCivilMexico', () => {
  it('a las 18:00 UTC del último día del mes en México sigue siendo ese día', () => {
    // 2026-04-30T23:59Z = 2026-04-30 17:59 en CDMX → sigue siendo el 30 de abril
    expect(hoyCivilMexico(new Date('2026-04-30T23:59:00.000Z')).toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('pasada la medianoche de México ya es el día siguiente', () => {
    // 2026-05-01T06:30Z = 2026-05-01 00:30 en CDMX
    expect(hoyCivilMexico(new Date('2026-05-01T06:30:00.000Z')).toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('un pago del último día del mes sigue siendo facturable a las 23:00 UTC de ese día', () => {
    const hoy = hoyCivilMexico(new Date('2026-04-30T23:00:00.000Z'));
    expect(estadoFacturaPago({ fecha: new Date('2026-04-30T00:00:00.000Z') }, hoy).facturable).toBe(true);
  });
});
