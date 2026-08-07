import { describe, it, expect } from 'vitest';
import { estadoFacturaPago, datosFiscalesEditables } from './candado.js';

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
  it('un cliente sin pagos se puede editar', () => {
    expect(datosFiscalesEditables([], HOY).editable).toBe(true);
  });

  it('con al menos un pago aún facturable, se puede editar', () => {
    const r = datosFiscalesEditables(
      [{ fecha: new Date('2026-03-01T00:00:00.000Z') }, { fecha: new Date('2026-04-02T00:00:00.000Z') }],
      HOY,
    );
    expect(r.editable).toBe(true);
  });

  it('si todos los pagos ya están cerrados, no se puede editar', () => {
    const r = datosFiscalesEditables(
      [{ fecha: new Date('2026-02-10T00:00:00.000Z') }, { fecha: new Date('2026-03-01T00:00:00.000Z') }],
      HOY,
    );
    expect(r.editable).toBe(false);
    expect(r.motivo).toMatch(/público en general/i);
  });

  it('los pagos anulados se ignoran al decidir', () => {
    const r = datosFiscalesEditables(
      [{ fecha: new Date('2026-04-02T00:00:00.000Z'), anuladoAt: new Date('2026-04-03T00:00:00.000Z') }],
      HOY,
    );
    // Solo tenía un pago y está anulado ⇒ es como no tener pagos.
    expect(r.editable).toBe(true);
  });
});
