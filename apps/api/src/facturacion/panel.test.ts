import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { COOKIE_NAME, loadConfig } from '../config.js';
import { signToken } from '../auth/jwt.js';
import { createQuote, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { registerPayment } from '../payments/service.js';
import type { ContextoFactura, ProveedorFactura } from './facturar.js';

/**
 * Panel de Facturación (26-nov-2026): solo con el permiso `accesoFacturacion`,
 * primero lo facturado y luego lo pendiente, sin efectivo, y cada pago se
 * factura por sí solo. El PAC es de mentiras.
 */

const LLAVE_BI = 'c'.repeat(40);
const storage = new ServerStorage(join(tmpdir(), 'hsa-panel-fact-' + randomUUID()));
const config = { ...loadConfig(), BI_API_KEY: LLAVE_BI };

let app: FastifyInstance;
let admin: Actor;
let conPermiso = '';
let sinPermiso = '';
const quotes: string[] = [];
const clients: string[] = [];
const uuids: string[] = [];

const contexto: ContextoFactura = {
  pac: {
    emitir: async () => {
      const uuid = randomUUID().toUpperCase();
      uuids.push(uuid);
      return { esValido: true, idComprobante: 1, uuid, subEstatusId: 1, descripcion: null, errores: null };
    },
    xml: async () => '<cfdi:Comprobante/>',
    pdf: async () => Buffer.from('%PDF-1.4'),
  },
  emisor: { rfc: 'AAA010101AAA', nombre: 'EMISOR DE PRUEBA', regimenFiscal: '601', codigoPostal: '53000' },
  serie: { nombre: 'A', id: 1 },
  concepto: { claveProdServ: '01010101', claveUnidad: 'E48' },
};
const proveedor: ProveedorFactura = async () => contexto;

const cookie = async (id: string, role: 'admin' | 'ventas') => ({ [COOKIE_NAME]: await signToken({ sub: id, role }, config.JWT_SECRET) });

// Un mes futuro y sin otros datos: el candado deja facturar los pagos del mes en curso.
const hoy = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const mes = hoy.slice(0, 7);

beforeAll(async () => {
  app = await buildServer({ config, facturacion: proveedor, mailer: null, lectorPac: null });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const mk = async (email: string, acceso: boolean) =>
    (await prisma.user.create({ data: { nombre: email, email, passwordHash: 'x', role: 'admin', accesoFacturacion: acceso } })).id;
  conPermiso = await mk(`fact-si-${randomUUID()}@local.test`, true);
  sinPermiso = await mk(`fact-no-${randomUUID()}@local.test`, false);
});

afterAll(async () => {
  await prisma.facturaPac.deleteMany({ where: { uuid: { in: uuids } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.user.deleteMany({ where: { id: { in: [conPermiso, sinPermiso] } } });
  await app.close();
});

async function eventoConPagos() {
  const arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  const eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  const q = await createQuote(
    prisma,
    { fecha: '2049-03-06', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { telefono: '5555550099', nombre: 'Panel Facturación' } },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  const pagar = async (formas: { forma: string; monto: number }[]) => {
    const monto = formas.reduce((s, f) => s + f.monto, 0);
    const datos = formas.length === 1 ? { monto, metodo: formas[0]!.forma, fecha: hoy } : { monto, formas, fecha: hoy };
    return (await registerPayment(prisma, storage, q.id, datos, admin)).payment;
  };
  return {
    efectivo: await pagar([{ forma: 'efectivo', monto: 3_000 }]),
    mixto: await pagar([
      { forma: 'efectivo', monto: 1_000 },
      { forma: 'transferencia', monto: 4_000 },
    ]),
    tarjeta: await pagar([{ forma: 'tarjetaDebito', monto: 2_500 }]),
  };
}

describe('acceso al panel', () => {
  it('sin sesión 401; sin el permiso 403 aunque sea admin; con el permiso entra', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/facturacion/panel' })).statusCode).toBe(401);
    const no = await app.inject({ method: 'GET', url: '/api/facturacion/panel', cookies: await cookie(sinPermiso, 'admin') });
    expect(no.statusCode).toBe(403);
    const si = await app.inject({ method: 'GET', url: '/api/facturacion/panel', cookies: await cookie(conPermiso, 'admin') });
    expect(si.statusCode).toBe(200);
  });

  it('quitarle el permiso surte efecto en la siguiente petición, sin cerrar sesión', async () => {
    const c = await cookie(conPermiso, 'admin');
    await prisma.user.update({ where: { id: conPermiso }, data: { accesoFacturacion: false } });
    expect((await app.inject({ method: 'GET', url: '/api/facturacion/panel', cookies: c })).statusCode).toBe(403);
    await prisma.user.update({ where: { id: conPermiso }, data: { accesoFacturacion: true } });
  });
});

describe('lo facturado y lo pendiente', () => {
  it('el efectivo no aparece; del mixto solo lo que no es efectivo; facturar uno lo pasa a facturados', async () => {
    const { efectivo, mixto, tarjeta } = await eventoConPagos();
    const c = await cookie(conPermiso, 'admin');
    const leer = async () => (await app.inject({ method: 'GET', url: `/api/facturacion/panel?mes=${mes}`, cookies: c })).json();

    const antes = await leer();
    const pendientes = antes.pendientes.pagos.filter((p: { quoteId: string }) => quotes.includes(p.quoteId));
    expect(pendientes.map((p: { pagoId: string }) => p.pagoId).sort()).toEqual([mixto.id, tarjeta.id].sort());
    expect(pendientes.find((p: { pagoId: string }) => p.pagoId === mixto.id).montoFacturable).toBe(4_000);
    const todo = [...antes.pendientes.pagos, ...antes.facturados.pagos, ...antes.noSeFacturan];
    expect(todo.some((p: { pagoId: string }) => p.pagoId === efectivo.id)).toBe(false);

    const r = await app.inject({ method: 'POST', url: `/api/facturacion/pagos/${tarjeta.id}/facturar`, cookies: c });
    expect(r.statusCode).toBe(200);
    const uuid = r.json().uuid as string;

    const despues = await leer();
    const facturado = despues.facturados.pagos.find((p: { pagoId: string }) => p.pagoId === tarjeta.id);
    expect(facturado).toMatchObject({ facturaUuid: uuid, pac: { uuid, origen: 'app', cancelada: false } });
    expect(despues.pendientes.pagos.some((p: { pagoId: string }) => p.pagoId === tarjeta.id)).toBe(false);

    // Sin permiso no se puede facturar por la ruta del panel.
    const no = await app.inject({ method: 'POST', url: `/api/facturacion/pagos/${mixto.id}/facturar`, cookies: await cookie(sinPermiso, 'admin') });
    expect(no.statusCode).toBe(403);
  });

  it('una factura del PAC que no sale de ningún pago aparece como hecha fuera de la app', async () => {
    const uuid = randomUUID().toUpperCase();
    uuids.push(uuid);
    await prisma.facturaPac.create({ data: { uuid, fecha: new Date(), total: 777, receptorRfc: 'XAXX010101000', origen: 'pac' } });
    const r = (await app.inject({ method: 'GET', url: `/api/facturacion/panel?mes=${mes}`, cookies: await cookie(conPermiso, 'admin') })).json();
    expect(r.fueraDeLaApp.some((f: { uuid: string }) => f.uuid === uuid)).toBe(true);
  });
});

describe('BI: facturas del PAC', () => {
  it('trae las facturas con su pago ligado y pide la llave', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/bi/facturacion/facturas' })).statusCode).toBe(401);
    const r = await app.inject({ method: 'GET', url: `/api/bi/facturacion/facturas?desde=${hoy}&hasta=${hoy}`, headers: { 'x-api-key': LLAVE_BI } });
    expect(r.statusCode).toBe(200);
    const facturas = r.json().facturas as { uuid: string; pago: { quoteId: string } | null; total: number }[];
    const deLaApp = facturas.filter((f) => f.pago && quotes.includes(f.pago.quoteId));
    expect(deLaApp).toHaveLength(1);
    expect(deLaApp[0]!.total).toBe(2_500);
  });

  it('rechaza fechas mal formadas o al revés', async () => {
    const h = { 'x-api-key': LLAVE_BI };
    expect((await app.inject({ method: 'GET', url: '/api/bi/facturacion/facturas?desde=2026-1-1', headers: h })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/bi/facturacion/facturas?desde=2026-12-01&hasta=2026-11-01', headers: h })).statusCode).toBe(400);
  });
});
