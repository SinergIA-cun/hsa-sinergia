import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { createQuote, loadEstadoCuenta, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { registerPayment } from '../payments/service.js';
import { registrarCargo, cuentaDelEvento } from '../cargos/service.js';
import { registrarDeposito, anularDeposito, listarDepositos } from '../banqueteros/cuenta.js';
import { crearApartado, cancelarApartado } from '../banqueteros/apartados.js';
import { registrarAbono } from '../banqueteros/abonos.js';
import { estadoCuentaBanquetero } from '../banqueteros/estadoCuenta.js';
import { biDevoluciones } from '../bi/service.js';
import { devolverACliente, devolverABanquetero, anularDevolucion, anotarNotaCredito } from './service.js';

/**
 * "Si un cliente pagó un monto de más, poder devolverle y que se marque" (el
 * dueño). Lo que se protege: que lo devuelto reste de lo pagado en el lado
 * correcto y que nunca se devuelva más de lo que entró.
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-devoluciones-test-' + randomUUID()));

let admin: Actor;
let ventas: Actor;
let arcosId: string;
let eventTypeId: string;
let banqueteroId: string;
const quotes: string[] = [];
const clients: string[] = [];

const PRIMER_SABADO = '2045-01-07';
let sabadoSeq = 0;
function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

async function nuevoEvento() {
  const q = await createQuote(
    prisma,
    { fecha: siguienteSabado(), invitados: 250, spaceIds: [arcosId], eventTypeId, client: { telefono: '5555550000', nombre: 'Devoluciones Test' } },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

const devolucion = (monto: number, extra: Record<string, unknown> = {}) => ({
  monto,
  metodo: 'transferencia',
  fecha: '2026-10-05',
  motivo: 'Pagó de más',
  ...extra,
});

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  ventas = { id: u.id, role: 'ventas' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Salón Los Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  banqueteroId = (await prisma.banquetero.create({ data: { nombre: `Devol ${randomUUID().slice(0, 6)}` } })).id;
});

afterAll(async () => {
  await prisma.devolucion.deleteMany({ where: { OR: [{ quoteId: { in: quotes } }, { banqueteroId }] } });
  await prisma.apartadoFecha.deleteMany({ where: { banqueteroId } });
  await prisma.cargoEvento.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.pagoBanquetero.deleteMany({ where: { banqueteroId } });
  await prisma.banquetero.delete({ where: { id: banqueteroId } });
});

describe('devolverle al cliente de un evento', () => {
  it('pagó de más: se le devuelve el excedente y la renta queda exacta', async () => {
    const q = await nuevoEvento();
    await registerPayment(prisma, storage, q.id, { monto: 110_000, metodo: 'transferencia', fecha: '2026-10-01' }, admin);
    expect((await loadEstadoCuenta(prisma, q)).estadoCuenta.saldo).toBe(-1_500);

    await devolverACliente(prisma, q.id, devolucion(1_500), admin);
    const ec = (await loadEstadoCuenta(prisma, q)).estadoCuenta;
    expect(ec.pagado).toBe(108_500);
    expect(ec.saldo).toBe(0);
    const log = await prisma.activityLog.count({ where: { quoteId: q.id, tipo: 'devolucion' } });
    expect(log).toBe(1);
  });

  it('no se devuelve más de lo que entró', async () => {
    const q = await nuevoEvento();
    await registerPayment(prisma, storage, q.id, { monto: 20_000, metodo: 'efectivo', fecha: '2026-10-01' }, admin);
    await expect(devolverACliente(prisma, q.id, devolucion(20_001), admin)).rejects.toMatchObject({ status: 409 });
  });

  it('solo admin', async () => {
    const q = await nuevoEvento();
    await expect(devolverACliente(prisma, q.id, devolucion(1), ventas)).rejects.toMatchObject({ status: 403 });
  });

  it('anular la devolución regresa lo pagado; la nota de crédito se puede anotar después', async () => {
    const q = await nuevoEvento();
    await registerPayment(prisma, storage, q.id, { monto: 30_000, metodo: 'efectivo', fecha: '2026-10-01' }, admin);
    const dev = await devolverACliente(prisma, q.id, devolucion(5_000), admin);
    const uuid = '11111111-2222-3333-4444-555555555555';
    expect((await anotarNotaCredito(prisma, dev.id, { notaCreditoUuid: uuid }, admin)).notaCreditoUuid).toBe(uuid);
    await anularDevolucion(prisma, dev.id, { motivo: 'se capturó dos veces' }, admin);
    expect((await loadEstadoCuenta(prisma, q)).estadoCuenta.pagado).toBe(30_000);
    await expect(anularDevolucion(prisma, dev.id, { motivo: 'otra vez' }, admin)).rejects.toMatchObject({ status: 409 });
  });

  it('de la cuenta del punto de venta: resta de lo cobrado ahí, no de la renta', async () => {
    const q = await nuevoEvento();
    await registerPayment(prisma, storage, q.id, { monto: 20_000, metodo: 'transferencia', fecha: '2026-10-01' }, admin);
    await registrarCargo(prisma, q.id, { producto: 'horaExtra', cantidad: 1, precioUnitario: 5_425, fecha: '2026-10-02' }, admin);
    await registerPayment(prisma, storage, q.id, { monto: 5_425, metodo: 'efectivo', destino: 'cargos', fecha: '2026-10-02' }, admin);
    const rentaAntes = (await loadEstadoCuenta(prisma, q)).estadoCuenta.pagado;

    await devolverACliente(prisma, q.id, devolucion(5_425, { destino: 'cargos', motivo: 'La hora extra no se usó' }), admin);
    expect(await cuentaDelEvento(prisma, q.id)).toMatchObject({ total: 5_425, pagado: 0, saldo: 5_425 });
    expect((await loadEstadoCuenta(prisma, q)).estadoCuenta.pagado).toBe(rentaAntes);
    // Y de la cuenta ya no se puede devolver más.
    await expect(
      devolverACliente(prisma, q.id, devolucion(1, { destino: 'cargos' }), admin),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('devolverle al banquetero su saldo a favor', () => {
  it('de un depósito: baja su saldo sin repartir y no se puede anular el depósito', async () => {
    const dep = await registrarDeposito(
      prisma, storage, banqueteroId, { monto: 50_000, metodo: 'transferencia', fecha: '2026-10-01' }, admin,
    );
    await devolverABanquetero(prisma, banqueteroId, devolucion(20_000, { pagoBanqueteroId: dep.id }), admin);
    const d = (await listarDepositos(prisma, banqueteroId)).find((x) => x.id === dep.id)!;
    expect(d.saldoSinAsignar).toBe(30_000);
    await expect(
      devolverABanquetero(prisma, banqueteroId, devolucion(30_001, { pagoBanqueteroId: dep.id }), admin),
    ).rejects.toMatchObject({ status: 409 });
    await expect(anularDeposito(prisma, dep.id, { motivo: 'error' }, admin)).rejects.toMatchObject({ status: 409 });
  });

  it('del saldo que le liberó un apartado cancelado', async () => {
    const { apartado } = await crearApartado(
      prisma, banqueteroId, { fechaEvento: siguienteSabado(), spaceIds: [arcosId] }, admin,
    );
    await registrarAbono(prisma, storage, apartado.id, { monto: 8_000, metodo: 'efectivo', fecha: '2026-10-01' }, admin);
    await cancelarApartado(prisma, apartado.id, { motivo: 'ya no lo quiere' }, admin);

    const antes = (await estadoCuentaBanquetero(prisma, banqueteroId)).totales;
    expect(antes.saldoLiberado).toBe(8_000);
    await devolverABanquetero(prisma, banqueteroId, devolucion(8_000, { motivo: 'Se le regresa el abono' }), admin);
    const despues = (await estadoCuentaBanquetero(prisma, banqueteroId)).totales;
    expect(despues.saldoLiberado).toBe(0);
    expect(despues.saldoAFavor).toBe(antes.saldoAFavor - 8_000);
    await expect(devolverABanquetero(prisma, banqueteroId, devolucion(1), admin)).rejects.toMatchObject({ status: 409 });
  });

  it('un depósito de otro banquetero no sirve', async () => {
    const otro = await prisma.banquetero.create({ data: { nombre: `Otro ${randomUUID().slice(0, 6)}` } });
    const dep = await registrarDeposito(
      prisma, storage, otro.id, { monto: 1_000, metodo: 'efectivo', fecha: '2026-10-01' }, admin,
    );
    await expect(
      devolverABanquetero(prisma, banqueteroId, devolucion(100, { pagoBanqueteroId: dep.id }), admin),
    ).rejects.toMatchObject({ status: 409 });
    await prisma.pagoBanquetero.delete({ where: { id: dep.id } });
    await prisma.banquetero.delete({ where: { id: otro.id } });
  });
});

describe('BI', () => {
  it('/devoluciones trae cada salida de dinero con de dónde salió', async () => {
    const q = await nuevoEvento();
    await registerPayment(prisma, storage, q.id, { monto: 5_000, metodo: 'efectivo', fecha: '2026-10-01' }, admin);
    await devolverACliente(prisma, q.id, devolucion(1_000, { fecha: '2026-10-09' }), admin);
    const filas = await biDevoluciones(prisma, {
      desde: new Date('2026-10-09T00:00:00Z'), hasta: new Date('2026-10-09T23:59:59Z'), limit: 500,
    });
    const mia = filas.find((f) => f.quoteId === q.id)!;
    expect(mia).toMatchObject({ monto: 1_000, de: 'evento', eventoFolio: q.folio, anulado: false });
  });

  it('una devolución no puede ser de un evento y de un banquetero a la vez (lo impide la base)', async () => {
    const q = await nuevoEvento();
    await expect(
      prisma.devolucion.create({
        data: { quoteId: q.id, banqueteroId, monto: 1, metodo: 'efectivo', fecha: new Date(), motivo: 'x' },
      }),
    ).rejects.toThrow();
  });
});
