import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { registerPayment } from '../payments/service.js';
import { facturarPago, facturarVarios, mesActual, pagosDelMes, type ContextoFactura, type ProveedorFactura } from './facturar.js';
import type { Mailer, Mensaje } from '../correos/mailer.js';

/**
 * Facturar con el PAC. Se protegen las reglas de Fernando (16 y 30-oct-2026): el
 * efectivo no se factura, al cliente solo si pidió factura y tiene sus datos, y si
 * no a público en general, pago por pago. El PAC es de mentiras: nunca se timbra.
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-facturar-test-' + randomUUID()));
const LLAVE_BI = 'b'.repeat(40);
const LLAVE_IMPORT = 'i'.repeat(40);

let app: FastifyInstance;
let admin: Actor;
let arcosId: string;
let eventTypeId: string;
const quotes: string[] = [];
const clients: string[] = [];

// Lo que el PAC recibió y lo que el correo mandó.
let emitidos: Record<string, unknown>[] = [];
let correos: Mensaje[] = [];
let rechazar = false;

const contexto: ContextoFactura = {
  pac: {
    emitir: async (c) => {
      emitidos.push(c as Record<string, unknown>);
      if (rechazar) return { esValido: false, idComprobante: 0, uuid: null, subEstatusId: 0, descripcion: null, errores: [{ codigo: 'CFDI40147', mensaje: 'RFC del receptor' }] };
      return { esValido: true, idComprobante: emitidos.length, uuid: randomUUID().toUpperCase(), subEstatusId: 1, descripcion: null, errores: null };
    },
    xml: async () => '<cfdi:Comprobante/>',
    pdf: async () => Buffer.from('%PDF-1.4'),
  },
  emisor: { rfc: 'AAA010101AAA', nombre: 'EMISOR DE PRUEBA', regimenFiscal: '601', codigoPostal: '53000' },
  serie: { nombre: 'A', id: 1 },
  concepto: { claveProdServ: '01010101', claveUnidad: 'E48' },
};
const proveedor: ProveedorFactura = async () => contexto;
const mailer: Mailer = { send: async (m) => void correos.push(m) };
const opciones = (ahora: Date) => ({ proveedor, mailer, actorId: admin.id, origen: 'app' as const, ahora });

// Septiembre de 2042: el candado deja facturar los pagos del mes en curso.
const AHORA = new Date('2042-09-20T18:00:00Z');
let sabadoSeq = 0;
function siguienteSabado(): string {
  const fecha = new Date(Date.UTC(2043, 0, 3));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

async function nuevoEvento(conDatosFiscales: boolean) {
  const q = await createQuote(
    prisma,
    { fecha: siguienteSabado(), invitados: 250, spaceIds: [arcosId], eventTypeId, client: { telefono: '5555550001', nombre: 'Facturar Test' } },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  if (conDatosFiscales) {
    await prisma.client.update({
      where: { id: q.clientId },
      data: { rfc: 'EKU9003173C9', razonSocial: 'Escuela Kemper Urgate', regimenFiscal: '601', cpFiscal: '06370', usoCfdi: 'G03', correoFacturacion: 'facturas@ejemplo.mx' },
    });
    await prisma.quote.update({ where: { id: q.id }, data: { requiereFactura: true } });
  }
  return q;
}

async function pagar(quoteId: string, fecha: string, formas: { forma: string; monto: number }[]) {
  const monto = formas.reduce((s, f) => s + f.monto, 0);
  const datos = formas.length === 1 ? { monto, metodo: formas[0]!.forma, fecha } : { monto, formas, fecha };
  const { payment } = await registerPayment(prisma, storage, quoteId, datos, admin);
  return payment;
}

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE_BI, BI_IMPORT_API_KEY: LLAVE_IMPORT }, facturacion: proveedor, mailer });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

beforeEach(() => {
  emitidos = [];
  correos = [];
  rechazar = false;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await app.close();
});

describe('facturar un pago', () => {
  it('al cliente con datos: solo la parte que no es efectivo, sella el pago y le manda XML y PDF', async () => {
    const q = await nuevoEvento(true);
    const p = await pagar(q.id, '2042-09-15', [
      { forma: 'efectivo', monto: 5_000 },
      { forma: 'transferencia', monto: 15_000 },
    ]);
    const r = await facturarPago(prisma, p.id, opciones(AHORA));
    expect(r).toMatchObject({ monto: 15_000, receptor: { tipo: 'cliente', rfc: 'EKU9003173C9' }, correo: 'enviado' });
    const cfdi = emitidos[0]!;
    expect(cfdi).toMatchObject({ total: 15_000, formaPago: '03', serie: 'A', receptor: { rfc: 'EKU9003173C9', nombre: 'ESCUELA KEMPER URGATE', usoCFDI: 'G03' } });
    expect(cfdi.informacionGlobal).toBeUndefined();
    const sellado = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(sellado.facturaUuid).toBe(r.uuid);
    expect(sellado.facturadoAt).not.toBeNull();
    expect(correos[0]!.to).toBe('facturas@ejemplo.mx');
    expect(correos[0]!.attachments!.map((a) => a.contentType)).toEqual(['application/xml', 'application/pdf']);
    // Ya facturado: no se factura dos veces.
    await expect(facturarPago(prisma, p.id, opciones(AHORA))).rejects.toMatchObject({ status: 409 });
  });

  it('sin datos del cliente: a público en general, con la información global del día y sin correo', async () => {
    const q = await nuevoEvento(false);
    const p = await pagar(q.id, '2042-09-16', [{ forma: 'tarjetaDebito', monto: 20_000 }]);
    const r = await facturarPago(prisma, p.id, opciones(AHORA));
    expect(r).toMatchObject({ receptor: { tipo: 'publicoGeneral', rfc: 'XAXX010101000' }, correo: 'sinCorreo' });
    expect(emitidos[0]).toMatchObject({
      formaPago: '28',
      receptor: { rfc: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL', regimenFiscalReceptor: '616', usoCFDI: 'S01', domicilioFiscalReceptor: '53000' },
      informacionGlobal: { periodicidad: '01', meses: '09', año: '2042' },
    });
    expect(correos).toHaveLength(0);
  });

  it('el efectivo no se factura y el PAC no se llama', async () => {
    const q = await nuevoEvento(true);
    const p = await pagar(q.id, '2042-09-16', [{ forma: 'efectivo', monto: 20_000 }]);
    await expect(facturarPago(prisma, p.id, opciones(AHORA))).rejects.toMatchObject({ status: 409, message: 'Pago en efectivo: no se factura.' });
    expect(emitidos).toHaveLength(0);
  });

  it('si el PAC la rechaza, el pago no se sella y el error dice por qué', async () => {
    const q = await nuevoEvento(true);
    const p = await pagar(q.id, '2042-09-17', [{ forma: 'transferencia', monto: 20_000 }]);
    rechazar = true;
    await expect(facturarPago(prisma, p.id, opciones(AHORA))).rejects.toMatchObject({ status: 502, message: expect.stringContaining('CFDI40147') });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).facturadoAt).toBeNull();
  });

  it('sin PAC configurado responde 503', async () => {
    const q = await nuevoEvento(false);
    const p = await pagar(q.id, '2042-09-17', [{ forma: 'transferencia', monto: 20_000 }]);
    await expect(facturarPago(prisma, p.id, { ...opciones(AHORA), proveedor: null })).rejects.toMatchObject({ status: 503 });
  });
});

describe('los pendientes del mes y facturar varios', () => {
  it('lista pendientes con su monto sin efectivo, factura varios y uno que falla no detiene a los demás', async () => {
    const q = await nuevoEvento(false);
    const a = await pagar(q.id, '2042-09-18', [{ forma: 'transferencia', monto: 20_000 }]);
    const b = await pagar(q.id, '2042-09-18', [
      { forma: 'efectivo', monto: 1_000 },
      { forma: 'tarjetaCredito', monto: 2_000 },
    ]);
    const soloEfectivo = await pagar(q.id, '2042-09-18', [{ forma: 'efectivo', monto: 3_000 }]);

    const mes = await pagosDelMes(prisma, '2042-09', AHORA);
    const delEvento = mes.pendientes.pagos.filter((x) => x.quoteId === q.id);
    expect(delEvento.map((x) => [x.pagoId, x.montoFacturable])).toEqual([
      [a.id, 20_000],
      [b.id, 2_000],
    ]);
    // El efectivo puro ni siquiera se lista.
    expect([...mes.pendientes.pagos, ...mes.noSeFacturan].some((x) => x.pagoId === soloEfectivo.id)).toBe(false);

    const r = await facturarVarios(prisma, [a.id, 'no-existe', b.id], opciones(AHORA));
    expect(r).toMatchObject({ facturados: 2, fallidos: 1 });
    const despues = await pagosDelMes(prisma, '2042-09', AHORA);
    expect(despues.pendientes.pagos.some((x) => x.quoteId === q.id)).toBe(false);
    expect(despues.facturados.pagos.filter((x) => x.quoteId === q.id)).toHaveLength(2);
  });

  it('por la ruta del BI: GET lista el mes en curso y POST todos: true factura los pendientes', async () => {
    const q = await nuevoEvento(false);
    const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
    const p = await pagar(q.id, hoy, [{ forma: 'transferencia', monto: 20_000 }]);

    const sinLlave = await app.inject({ method: 'GET', url: '/api/bi/facturacion/pagos' });
    expect(sinLlave.statusCode).toBe(401);
    const lista = await app.inject({ method: 'GET', url: '/api/bi/facturacion/pagos', headers: { 'x-api-key': LLAVE_BI } });
    expect(lista.statusCode).toBe(200);
    expect(lista.json().mes).toBe(mesActual());
    expect(lista.json().pendientes.pagos.some((x: { pagoId: string }) => x.pagoId === p.id)).toBe(true);

    // Escribir es con la llave de importación, no con la de lectura.
    const conLectura = await app.inject({ method: 'POST', url: '/api/bi/facturacion/facturar', headers: { 'x-api-key': LLAVE_BI }, payload: { pagoIds: [p.id] } });
    expect(conLectura.statusCode).toBe(401);
    const malo = await app.inject({ method: 'POST', url: '/api/bi/facturacion/facturar', headers: { 'x-api-key': LLAVE_IMPORT }, payload: {} });
    expect(malo.statusCode).toBe(400);
    const todos = await app.inject({ method: 'POST', url: '/api/bi/facturacion/facturar', headers: { 'x-api-key': LLAVE_IMPORT }, payload: { todos: true } });
    expect(todos.statusCode).toBe(200);
    expect(todos.json().resultados.some((x: { pagoId: string; ok: boolean }) => x.pagoId === p.id && x.ok)).toBe(true);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { quoteId: q.id, tipo: 'factura' } });
    expect(log.descripcion).toContain('desde el BI');
  });
});
