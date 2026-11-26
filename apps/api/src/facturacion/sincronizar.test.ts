import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@hsa/database';
import { esCancelada, filaDePac, proximaRevision, sincronizarFacturas, ventanaDeRevision, type LectorPac } from './sincronizar.js';

/** Sincronización de facturas con el PAC (26-nov-2026). Cancún = UTC-5 todo el año. */

describe('proximaRevision', () => {
  it('a las 7:00 de Cancún toca la de las 8:00', () => {
    expect(proximaRevision(new Date('2026-11-26T12:00:00Z')).toISOString()).toBe('2026-11-26T13:00:00.000Z');
  });
  it('a las 8:00 en punto ya pasó: sigue la de las 13:00', () => {
    expect(proximaRevision(new Date('2026-11-26T13:00:00Z')).toISOString()).toBe('2026-11-26T18:00:00.000Z');
  });
  it('a las 15:00 toca la de las 19:00', () => {
    expect(proximaRevision(new Date('2026-11-26T20:00:00Z')).toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });
  it('después de las 19:00 toca la de las 8:00 del día siguiente', () => {
    expect(proximaRevision(new Date('2026-11-27T01:30:00Z')).toISOString()).toBe('2026-11-27T13:00:00.000Z');
  });
  it('cruza fin de mes y de año', () => {
    expect(proximaRevision(new Date('2027-01-01T03:00:00Z')).toISOString()).toBe('2027-01-01T13:00:00.000Z');
  });
});

describe('ventanaDeRevision', () => {
  it('va del primer día del mes anterior (Cancún) hasta ahora', () => {
    const ahora = new Date('2026-11-26T18:00:00Z');
    const v = ventanaDeRevision(ahora);
    expect(v.desde.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(v.hasta).toEqual(ahora);
  });
  it('en enero arranca en diciembre del año anterior', () => {
    expect(ventanaDeRevision(new Date('2027-01-10T18:00:00Z')).desde.toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });
});

describe('esCancelada', () => {
  it('reconoce la cancelada y no la que espera respuesta del receptor', () => {
    expect(esCancelada('Cancelado', null)).toBe(true);
    expect(esCancelada('Emitido', 'Cancelado (Directo)')).toBe(true);
    expect(esCancelada('Emitido', 'Emitido (Espera Cancelación)')).toBe(false);
    expect(esCancelada('Emitido', 'Timbrado')).toBe(false);
    expect(esCancelada(null, null)).toBe(false);
  });
});

describe('filaDePac', () => {
  it('lee los campos del listado y guarda el renglón crudo', () => {
    const r = {
      idComprobante: 77,
      uuid: 'aaaa-bbbb',
      fecha: '2026-11-20T10:15:00',
      serie: 'A',
      folio: 12,
      estatus: 'Emitido',
      subestatus: 'Timbrado',
      subtotal: 862.07,
      impuestos: 137.93,
      total: 1000,
      moneda: 'MXN',
      receptorRfc: 'EKU9003173C9',
      receptorNombre: 'ESCUELA KEMPER URGATE',
      satFormaPagoClave: '03',
      satFormaPagoNombre: 'Transferencia',
      tipoComprobante: 'Factura',
    };
    const f = filaDePac(r)!;
    expect(f).toMatchObject({
      uuid: 'AAAA-BBBB',
      idComprobante: 77,
      serie: 'A',
      folio: '12',
      total: 1000,
      receptorRfc: 'EKU9003173C9',
      formaPagoClave: '03',
      cancelada: false,
    });
    // Sin zona = hora de México (Cancún, UTC-5).
    expect(f.fecha.toISOString()).toBe('2026-11-20T15:15:00.000Z');
    expect(f.crudo).toEqual(r);
  });
  it('sin UUID (comprobante sin timbrar) no se guarda', () => {
    expect(filaDePac({ total: 5, fecha: '2026-11-20T10:00:00' })).toBeNull();
  });
});

describe('sincronizarFacturas', () => {
  const UUIDS = ['PRUEBA-SINC-1', 'PRUEBA-SINC-2'];
  const limpiar = async () => {
    await prisma.facturaPac.deleteMany({ where: { uuid: { in: UUIDS } } });
    await prisma.sincronizacionPac.deleteMany({ where: { motivo: 'prueba' } });
  };
  beforeEach(limpiar);
  afterAll(limpiar);

  const renglon = (uuid: string, extra: Record<string, unknown> = {}) => ({
    uuid,
    fecha: '2026-11-20T10:00:00',
    total: 500,
    estatus: 'Emitido',
    ...extra,
  });

  it('pagina, crea las nuevas, actualiza las conocidas y deja registro', async () => {
    const paginas: Record<string, unknown>[][] = [[renglon(UUIDS[0]!)], [renglon(UUIDS[1]!)]];
    const pedidas: number[] = [];
    const lector: LectorPac = async ({ skip }) => {
      pedidas.push(skip);
      return { total: 2, renglones: paginas[skip] ?? [] };
    };
    const r1 = await sincronizarFacturas(prisma, lector, { motivo: 'prueba', tamPagina: 1 });
    expect(r1).toMatchObject({ ok: true, nuevas: 2, actualizadas: 0 });
    expect(pedidas).toEqual([0, 1]);

    // La segunda vuelta trae la primera ya cancelada.
    paginas[0] = [renglon(UUIDS[0]!, { subestatus: 'Cancelado (Directo)' })];
    const r2 = await sincronizarFacturas(prisma, lector, { motivo: 'prueba', tamPagina: 1 });
    expect(r2).toMatchObject({ ok: true, nuevas: 0, actualizadas: 2 });
    expect((await prisma.facturaPac.findUnique({ where: { uuid: UUIDS[0]! } }))?.cancelada).toBe(true);
  });

  it('si el PAC falla, queda registrada la vuelta con el error y no truena', async () => {
    const r = await sincronizarFacturas(
      prisma,
      async () => {
        throw new Error('PAC caído');
      },
      { motivo: 'prueba' },
    );
    expect(r).toMatchObject({ ok: false, error: 'PAC caído' });
    const ultima = await prisma.sincronizacionPac.findFirst({ where: { motivo: 'prueba' }, orderBy: { inicio: 'desc' } });
    expect(ultima).toMatchObject({ ok: false, error: 'PAC caído' });
  });

  it('una factura timbrada por la app no pierde su origen al sincronizar', async () => {
    await prisma.facturaPac.create({ data: { uuid: UUIDS[0]!, fecha: new Date(), total: 500, origen: 'app' } });
    await sincronizarFacturas(prisma, async () => ({ total: 1, renglones: [renglon(UUIDS[0]!)] }), { motivo: 'prueba' });
    expect((await prisma.facturaPac.findUnique({ where: { uuid: UUIDS[0]! } }))?.origen).toBe('app');
  });
});
