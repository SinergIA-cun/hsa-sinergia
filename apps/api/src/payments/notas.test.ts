import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { createQuote, getByToken, type Actor } from '../quotes/service.js';
import { ServerStorage } from './storage.js';
import { registerPayment, editarNotasPago, anularPayment } from './service.js';
import { registrarDeposito, asignarDeposito, editarNotasDeposito } from '../banqueteros/cuenta.js';
import { biPagos } from '../bi/service.js';

/**
 * "Agrega a cada pago un campo llamado Notas: que ahí se escriba cualquier cosa
 * que ayude a entender el pago" (el dueño, 1-oct-2026).
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-notas-test-' + randomUUID()));
let admin: Actor;
let ventas: Actor;
let arcosId: string;
let eventTypeId: string;
let banqueteroId: string;
const quotes: string[] = [];
const clients: string[] = [];

let semana = 0;
const sabado = () => new Date(Date.UTC(2052, 0, 6 + 7 * semana++)).toISOString().slice(0, 10);

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  ventas = { id: u.id, role: 'ventas' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  banqueteroId = (
    await prisma.banquetero.create({ data: { nombre: `Notas ${randomUUID().slice(0, 6)}`, telefono: '5555550000' } })
  ).id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.pagoBanquetero.deleteMany({ where: { banqueteroId } });
  await prisma.banquetero.delete({ where: { id: banqueteroId } });
});

async function evento(extra: Record<string, unknown> = {}) {
  const q = await createQuote(
    prisma,
    { fecha: sabado(), invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Notas Test', telefono: '5512345678' }, ...extra },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

describe('notas de un pago', () => {
  it('se guardan al registrar, sin espacios de sobra; en blanco no es nota', async () => {
    const q = await evento();
    const { payment } = await registerPayment(
      prisma, storage, q.id,
      { monto: 5_000, metodo: 'efectivo', fecha: '2026-10-01', notas: '  Pagó la tía de la novia  ' },
      admin,
    );
    expect(payment.notas).toBe('Pagó la tía de la novia');
    const { payment: otro } = await registerPayment(
      prisma, storage, q.id, { monto: 1_000, metodo: 'efectivo', fecha: '2026-10-01', notas: '   ' }, admin,
    );
    expect(otro.notas).toBeNull();
  });

  it('ventas las corrige en lo suyo, también en un pago anulado, y queda en la bitácora', async () => {
    const q = await evento();
    const { payment } = await registerPayment(
      prisma, storage, q.id, { monto: 5_000, metodo: 'cheque', fecha: '2026-10-01' }, admin,
    );
    await editarNotasPago(prisma, q.id, payment.id, { notas: 'El cheque se cobra el lunes' }, ventas);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).notas).toBe('El cheque se cobra el lunes');
    const log = await prisma.activityLog.findFirst({ where: { quoteId: q.id, tipo: 'edicion' }, orderBy: { createdAt: 'desc' } });
    expect(log?.descripcion).toContain('El cheque se cobra el lunes');

    await anularPayment(prisma, q.id, payment.id, 'Rebotó', admin);
    await editarNotasPago(prisma, q.id, payment.id, { notas: 'Rebotó: fondos insuficientes' }, ventas);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).notas).toBe('Rebotó: fondos insuficientes');
  });

  it('el cliente no las ve: su página no trae las notas', async () => {
    const q = await evento();
    await registerPayment(
      prisma, storage, q.id, { monto: 5_000, metodo: 'efectivo', fecha: '2026-10-01', notas: 'Dato interno' }, admin,
    );
    const pub = await getByToken(prisma, q.publicToken);
    expect(JSON.stringify(pub)).not.toContain('Dato interno');
  });

  it('más de 1000 caracteres se rechaza', async () => {
    const q = await evento();
    await expect(
      registerPayment(prisma, storage, q.id, { monto: 1_000, metodo: 'efectivo', fecha: '2026-10-01', notas: 'x'.repeat(1001) }, admin),
    ).rejects.toThrow();
  });

  it('el BI las recibe en /pagos', async () => {
    const q = await evento();
    const { payment } = await registerPayment(
      prisma, storage, q.id, { monto: 5_000, metodo: 'efectivo', fecha: '2026-10-07', notas: 'Para el BI' }, admin,
    );
    const filas = await biPagos(prisma, {
      desde: new Date('2026-10-07T00:00:00Z'), hasta: new Date('2026-10-07T23:59:59Z'), limit: 500,
    });
    expect(filas.find((f) => f.id === payment.id)?.notas).toBe('Para el BI');
  });
});

describe('notas de un depósito', () => {
  it('los pagos que salen de repartirlo heredan sus notas; un admin las corrige', async () => {
    const q = await evento({ banqueteroId });
    const dep = await registrarDeposito(
      prisma, storage, banqueteroId,
      { monto: 30_000, metodo: 'transferencia', fecha: '2026-10-01', notas: 'Depósito de las tres bodas de octubre' },
      admin,
    );
    expect(dep.notas).toBe('Depósito de las tres bodas de octubre');
    await asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: q.id, monto: 20_000 }] }, admin);
    const pago = await prisma.payment.findFirstOrThrow({ where: { pagoBanqueteroId: dep.id } });
    expect(pago.notas).toBe('Depósito de las tres bodas de octubre');

    await expect(editarNotasDeposito(prisma, dep.id, { notas: 'x' }, ventas)).rejects.toMatchObject({ status: 403 });
    const r = await editarNotasDeposito(prisma, dep.id, { notas: null }, admin);
    expect(r.notas).toBeNull();
  });
});

describe('notas por parte de un pago dividido', () => {
  // "Si hago 2 transferencias, poder agregar de qué banco vino cada una" (el
  // dueño, 5-oct-2026).
  it('dos transferencias, cada una con su banco; la bitácora las dice y el cliente no las ve', async () => {
    const q = await evento();
    const { payment } = await registerPayment(
      prisma, storage, q.id,
      {
        monto: 10_000,
        formas: [
          { forma: 'transferencia', monto: 6_000, nota: 'BBVA' },
          { forma: 'transferencia', monto: 4_000, nota: 'Santander, la hizo el papá' },
        ],
        fecha: '2026-10-01',
      },
      admin,
    );
    expect(payment.metodo).toBe('mixto');
    expect(payment.formas).toEqual([
      { forma: 'transferencia', monto: 6_000, nota: 'BBVA' },
      { forma: 'transferencia', monto: 4_000, nota: 'Santander, la hizo el papá' },
    ]);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { quoteId: q.id, tipo: 'pago' }, orderBy: { createdAt: 'desc' } });
    expect(log.descripcion).toContain('(BBVA)');
    const pub = await getByToken(prisma, q.publicToken);
    expect(JSON.stringify(pub)).not.toContain('Santander');
  });
});

