import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { createQuote, type Actor } from '../quotes/service.js';
import { registerPayment } from '../payments/service.js';
import { ServerStorage } from '../payments/storage.js';
import { descuadres } from './descuadres.js';

/** Descuadres entre lo contratado y lo cobrado (reunión del 15-oct-2026). */

const storage = new ServerStorage(join(tmpdir(), 'hsa-descuadres-' + randomUUID()));
let admin: Actor;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];
const HOY = new Date('2065-06-01T00:00:00.000Z');

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.correoCliente.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
});

async function evento(fecha: string) {
  const q = await createQuote(prisma, { fecha, invitados: 200, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Descuadre Test', telefono: '5516161616', correo: 'd@example.com' } }, admin);
  quotes.push(q.id);
  return q;
}
const pagar = (id: string, monto: number) => registerPayment(prisma, storage, id, { monto, metodo: 'transferencia', fecha: '2026-10-01' }, admin);

describe('descuadres', () => {
  it('pasado con saldo, cobrado de más y cuadrado; solo admin', async () => {
    const conSaldo = await evento('2065-05-02');
    await pagar(conSaldo.id, 20_000);
    const deMas = await evento('2065-08-02');
    await pagar(deMas.id, deMas.total);
    await prisma.quote.update({ where: { id: deMas.id }, data: { rentaTotal: deMas.rentaTotal - 1_000, total: deMas.total - 1_000 } });
    const cuadrado = await evento('2065-05-09');
    await pagar(cuadrado.id, cuadrado.total);
    const cerrado = await evento('2065-05-16');
    await pagar(cerrado.id, 1_000);
    await prisma.quote.update({ where: { id: cerrado.id }, data: { cerradoAt: new Date() } });

    const lista = await descuadres(prisma, admin, HOY);
    const de = (id: string) => lista.find((d) => d.quoteId === id);
    expect(de(conSaldo.id)?.motivos.join()).toMatch(/Renta sin cobrar/);
    expect(de(deMas.id)?.motivos.join()).toMatch(/cobrada de más: \$1,000/);
    expect(de(cuadrado.id)).toBeUndefined();
    expect(de(cerrado.id)).toBeUndefined();
    await expect(descuadres(prisma, { id: admin.id, role: 'ventas' }, HOY)).rejects.toMatchObject({ status: 403 });
  });
});
