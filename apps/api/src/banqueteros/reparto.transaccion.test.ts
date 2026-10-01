import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { createQuote, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { registrarDeposito, asignarDeposito } from './cuenta.js';

/**
 * El reparto de un depósito es todo o nada.
 *
 * Para probarlo hace falta que un renglón falle DESPUÉS de que otro ya escribió,
 * y eso no se logra con datos: todo lo que se puede validar se valida antes de
 * empezar. Así que se sustituye `registerPayment` por uno que hace el primer
 * pago de verdad y truena en el segundo. Sin la transacción, el primer pago se
 * quedaba escrito.
 */
vi.mock('../payments/service.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../payments/service.js')>();
  let llamadas = 0;
  return {
    ...real,
    registerPayment: vi.fn(async (...args: Parameters<typeof real.registerPayment>) => {
      llamadas += 1;
      if (llamadas === 2) throw new Error('falla a la mitad del reparto');
      return real.registerPayment(...args);
    }),
  };
});

const storage = new ServerStorage(join(tmpdir(), 'hsa-reparto-tx-' + randomUUID()));
let actor: Actor;
let banqueteroId: string;
const quotes: string[] = [];
const clients: string[] = [];

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: u.id, role: 'admin' };
  banqueteroId = (await prisma.banquetero.create({ data: { nombre: `Tx ${randomUUID().slice(0, 6)}` } })).id;
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

describe('reparto de un depósito', () => {
  it('si el segundo renglón falla, el primero tampoco queda', async () => {
    const arcos = await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } });
    const boda = await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } });
    const eventos = [];
    for (const fecha of ['2047-01-05', '2047-01-12']) {
      const q = await createQuote(
        prisma,
        { fecha, invitados: 250, spaceIds: [arcos.id], eventTypeId: boda.id, client: { telefono: '5555550000', nombre: 'Reparto Tx' }, banqueteroId },
        actor,
      );
      quotes.push(q.id);
      clients.push(q.clientId);
      eventos.push(q);
    }
    const dep = await registrarDeposito(
      prisma, storage, banqueteroId, { monto: 100_000, metodo: 'transferencia', fecha: '2026-10-01' }, actor,
    );

    await expect(
      asignarDeposito(
        prisma,
        storage,
        dep.id,
        { asignaciones: eventos.map((q) => ({ quoteId: q.id, monto: 30_000 })) },
        actor,
      ),
    ).rejects.toThrow('falla a la mitad del reparto');

    expect(await prisma.payment.count({ where: { pagoBanqueteroId: dep.id } })).toBe(0);
    expect(await prisma.payment.count({ where: { quoteId: eventos[0]!.id } })).toBe(0);
  });
});
