import { describe, it, expect } from 'vitest';
import { MARCA_POR_OMISION } from '@hsa/shared';
import { correoBienvenida, correoCierre, correoRecibo, type EventoCorreo, type PagoCorreo } from './plantillas.js';
import { sumarHabiles } from './habiles.js';
import { reciboPdf } from './reciboPdf.js';

const evento: EventoCorreo = {
  cliente: 'Ana <López>',
  codigo: '14NOV26-ALOPEZ-ARCOS',
  tipoEvento: 'Boda',
  fecha: '2026-11-14',
  salones: ['Arcos'],
  invitados: 250,
  renta: 108_500,
  pagado: 30_000,
  saldo: 78_500,
  plan: [
    { label: 'Apartar fecha', objetivo: 30_000, completo: true, venceISO: null },
    { label: 'A cuenta', objetivo: 60_000, completo: false, venceISO: '2026-08-01' },
  ],
};
const pago: PagoCorreo = { folio: 'I 5341', monto: 30_000, fecha: '2026-10-07', concepto: 'Anticipo', formas: [{ forma: 'Transferencia', monto: 30_000 }] };

describe('días hábiles', () => {
  it('se salta sábado y domingo', () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(sumarHabiles(d('2026-11-14'), 2).toISOString().slice(0, 10)).toBe('2026-11-17'); // sáb → mar
    expect(sumarHabiles(d('2026-11-13'), 2).toISOString().slice(0, 10)).toBe('2026-11-17'); // vie → mar
    expect(sumarHabiles(d('2026-11-11'), 2).toISOString().slice(0, 10)).toBe('2026-11-13'); // mié → vie
  });
});

describe('plantillas', () => {
  it('bienvenida: datos del evento, plan, recibo adjunto; sin enlaces y con el nombre escapado', () => {
    const c = correoBienvenida(MARCA_POR_OMISION, evento, pago);
    expect(c.subject).toContain('confirmado');
    expect(c.html).toContain('Ana &lt;López&gt;');
    expect(c.html).not.toContain('<López>');
    expect(c.html).toContain('14NOV26-ALOPEZ-ARCOS');
    expect(c.html).toContain('A cuenta');
    expect(c.html).toContain('I 5341');
    expect(c.html).not.toMatch(/href=/);
    expect(c.text).toContain('Saldo: $78,500');
  });

  it('recibo de la cuenta del punto de venta no habla de la renta', () => {
    const c = correoRecibo(MARCA_POR_OMISION, evento, { ...pago, concepto: 'Cargos adicionales del evento' }, true);
    expect(c.subject).toBe('Recibo I 5341 · Hacienda San Andrés');
    expect(c.html).not.toContain('Renta del evento');
  });

  it('cierre: contrato, extras, total e invitación a recomendar', () => {
    const c = correoCierre(MARCA_POR_OMISION, evento, {
      contrato: 300_000,
      extras: [
        { nombre: 'Hora extra de salón', cantidad: 2, total: 10_850 },
        { nombre: 'Hora extra de DJ', cantidad: 1, total: 2_950 },
      ],
    });
    expect(c.html).toContain('Hora extra de salón (2)');
    expect(c.text).toContain('Total del evento: $313,800');
    expect(c.html).toContain('recomiéndenos');
    expect(c.html).not.toContain('.pdf');
  });

  it('el recibo en PDF se genera, con acentos', async () => {
    const pdf = await reciboPdf(MARCA_POR_OMISION, { ...evento, cliente: 'Ana López Muñoz', referencia: 1042 }, pago, new Date('2026-10-07T12:00:00Z'));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
