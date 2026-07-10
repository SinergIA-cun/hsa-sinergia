import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, type Actor } from '../quotes/service.js';
import { registerPayment, anularPayment } from './service.js';
import { PendingStorage } from './storage.js';

let actor: Actor;
let arcosId: string, eventTypeId: string;
const quotes: string[] = [];
const clients: string[] = [];

beforeAll(async () => {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } }))!.id;
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
});

async function nuevaQuote() {
  const q = await createQuote(prisma, { fecha: '2027-05-08', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Pago Test' } }, actor);
  quotes.push(q.id); clients.push(q.clientId);
  return q;
}

describe('registerPayment / anularPayment', () => {
  it('registra un pago y recalcula estado de cuenta', async () => {
    const q = await nuevaQuote();
    const res = await registerPayment(prisma, new PendingStorage(), q.id, {
      monto: 20000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2027-01-10',
    }, actor);
    expect(res.estadoCuenta.pagado).toBe(20000);
    expect(res.payment.comprobantePendiente).toBe(false);
    expect(res.sugerenciaUpgrade).toBe('apartada');
  });

  it('anular excluye el pago del acumulado (solo admin)', async () => {
    const q = await nuevaQuote();
    const { payment } = await registerPayment(prisma, new PendingStorage(), q.id, {
      monto: 20000, metodo: 'efectivo', concepto: 'anticipo', fecha: '2027-01-10',
    }, actor);
    const after = await anularPayment(prisma, q.id, payment.id, 'monto equivocado', actor);
    expect(after.estadoCuenta.pagado).toBe(0);
  });

  it('vendedora no puede anular', async () => {
    const q = await nuevaQuote();
    const { payment } = await registerPayment(prisma, new PendingStorage(), q.id, {
      monto: 5000, metodo: 'efectivo', concepto: 'aCuenta', fecha: '2027-01-10',
    }, actor);
    await expect(
      anularPayment(prisma, q.id, payment.id, 'x', { id: actor.id, role: 'vendedora' }),
    ).rejects.toThrow();
  });
});
