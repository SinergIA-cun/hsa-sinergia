import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { MARCA_POR_OMISION } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, type Actor } from '../quotes/service.js';
import { registerPayment } from '../payments/service.js';
import { ServerStorage } from '../payments/storage.js';
import { encolarCierres, procesarCola } from './cola.js';
import type { Mailer, Mensaje } from './mailer.js';

/** Correos al cliente: bienvenida al formalizar, recibo por pago, cierre (6-oct-2026). */

const storage = new ServerStorage(join(tmpdir(), 'hsa-correos-' + randomUUID()));
let app: FastifyInstance;
let admin: Actor;
let cookie: Record<string, string>;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];

/** Un correo de mentiras que guarda lo que "mandó". */
function buzon(falla = false): Mailer & { enviados: Mensaje[] } {
  const enviados: Mensaje[] = [];
  return {
    enviados,
    async send(m) {
      if (falla) throw new Error('SMTP caído');
      enviados.push(m);
    },
  };
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'admin1234' } });
  const c = login.cookies[0]!;
  cookie = { [c.name]: c.value };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  // Que la cola empiece limpia de lo que dejen otras suites.
  await prisma.correoCliente.updateMany({ where: { estado: { in: ['pendiente', 'error'] } }, data: { estado: 'omitido' } });
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.cargoEvento.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await app.close();
});

let semana = 0;
const sabado = () => new Date(Date.UTC(2059, 0, 4 + 7 * semana++)).toISOString().slice(0, 10);

async function evento(correo: string | null = 'cliente@example.com', fecha = sabado()) {
  const q = await createQuote(
    prisma,
    { fecha, invitados: 200, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Cliente Correos', telefono: '5517171717', ...(correo ? { correo } : {}) } },
    admin,
  );
  quotes.push(q.id);
  return q;
}
const pagar = async (quoteId: string, monto: number) =>
  (await registerPayment(prisma, storage, quoteId, { monto, metodo: 'transferencia', fecha: '2026-10-07' }, admin)).payment;
const correosDe = (quoteId: string) => prisma.correoCliente.findMany({ where: { quoteId }, orderBy: { createdAt: 'asc' } });

describe('correos al cliente', () => {
  it('el pago que formaliza manda la bienvenida con su recibo; los siguientes, su recibo', async () => {
    const q = await evento();
    const p1 = await pagar(q.id, q.total);
    expect(await correosDe(q.id)).toEqual([expect.objectContaining({ tipo: 'bienvenida', paymentId: p1.id, estado: 'pendiente' })]);

    const q2 = await evento();
    const a = await pagar(q2.id, 40_000);
    const b = await pagar(q2.id, 10_000);
    expect((await correosDe(q2.id)).map((c) => [c.tipo, c.paymentId])).toEqual([
      ['bienvenida', a.id],
      ['recibo', b.id],
    ]);

    const mailer = buzon();
    const r = await procesarCola(prisma, mailer, MARCA_POR_OMISION);
    expect(r.enviados).toBeGreaterThanOrEqual(3);
    const mios = mailer.enviados.filter((m) => m.to === 'cliente@example.com');
    expect(mios.map((m) => m.subject)).toEqual(
      expect.arrayContaining([expect.stringContaining('confirmado'), expect.stringContaining('Recibo I ')]),
    );
    for (const m of mios) {
      expect(m.attachments?.[0]?.contentType).toBe('application/pdf');
      expect(m.attachments![0]!.content.subarray(0, 4).toString()).toBe('%PDF');
    }
    expect((await correosDe(q2.id)).every((c) => c.estado === 'enviado' && c.para === 'cliente@example.com')).toBe(true);
  });

  it('sin correo del cliente se omite; si el envío falla se reintenta', async () => {
    const sin = await evento(null);
    await pagar(sin.id, 5_000);
    const conError = await evento('otro@example.com');
    await pagar(conError.id, 5_000);

    await procesarCola(prisma, buzon(true), MARCA_POR_OMISION);
    expect((await correosDe(sin.id))[0]).toMatchObject({ estado: 'omitido', error: 'El cliente no tiene correo.' });
    expect((await correosDe(conError.id))[0]).toMatchObject({ estado: 'error', intentos: 1, error: 'SMTP caído' });

    const mailer = buzon();
    await procesarCola(prisma, mailer, MARCA_POR_OMISION);
    expect((await correosDe(conError.id))[0]).toMatchObject({ estado: 'enviado', intentos: 2 });
  });

  it('sin SMTP no se manda nada, y lo de hace más de 3 días ya no se manda', async () => {
    const q = await evento();
    await pagar(q.id, 5_000);
    await procesarCola(prisma, null, MARCA_POR_OMISION);
    expect((await correosDe(q.id))[0]!.estado).toBe('pendiente');
    await procesarCola(prisma, null, MARCA_POR_OMISION, new Date(Date.now() + 4 * 24 * 60 * 60 * 1000));
    expect((await correosDe(q.id))[0]).toMatchObject({ estado: 'omitido', error: 'El correo de salida no está configurado.' });
  });

  it('el cierre sale a los 2 días hábiles, con el contrato y los extras', async () => {
    const q = await evento('cierre@example.com', '2026-09-26'); // sábado
    await prisma.quote.update({ where: { id: q.id }, data: { status: 'liquidada' } });
    await prisma.cargoEvento.create({
      data: { quoteId: q.id, producto: 'djHoraExtra', descripcion: 'Hora extra de DJ', cantidad: 1, precioUnitario: 2_950, total: 2_950, fecha: new Date('2026-09-26T00:00:00Z'), registradoById: admin.id },
    });
    await encolarCierres(prisma, new Date('2026-09-28T00:00:00Z')); // lunes: todavía no
    expect(await correosDe(q.id)).toEqual([]);
    await encolarCierres(prisma, new Date('2026-09-29T00:00:00Z')); // martes
    expect((await correosDe(q.id)).map((c) => c.tipo)).toEqual(['cierre']);
    await encolarCierres(prisma, new Date('2026-09-30T00:00:00Z'));
    expect((await correosDe(q.id)).length).toBe(1); // una sola vez

    const mailer = buzon();
    await procesarCola(prisma, mailer, MARCA_POR_OMISION);
    const m = mailer.enviados.find((x) => x.to === 'cierre@example.com')!;
    expect(m.subject).toContain('Gracias');
    expect(m.text).toContain('Hora extra de DJ');
    expect(m.text).toContain(`Total del evento: ${new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(q.total + 2_950)}`);
    expect(m.attachments).toEqual([]);
  });
});

describe('el correo es obligatorio al formalizar (desde la pantalla)', () => {
  it('el pago que formaliza sin correo se rechaza; uno chico, no; con correo pasa y encola', async () => {
    const q = await evento(null);
    const pago = (monto: number) =>
      app.inject({ method: 'POST', url: `/api/quotes/${q.id}/payments`, cookies: cookie, payload: { monto, metodo: 'efectivo', fecha: '2026-10-07' } });
    expect((await pago(q.total)).statusCode).toBe(409);
    expect((await pago(1_000)).statusCode).toBe(201);
    await prisma.client.update({ where: { id: q.clientId }, data: { correo: 'ya@example.com' } });
    expect((await pago(q.total)).statusCode).toBe(201);
    expect((await correosDe(q.id)).map((c) => c.tipo)).toEqual(['recibo', 'bienvenida']);
  });

  it('formalizar a mano sin correo se rechaza; con correo manda la bienvenida y se ve en el evento', async () => {
    const q = await evento(null);
    const formalizar = () =>
      app.inject({ method: 'PATCH', url: `/api/quotes/${q.id}/status`, cookies: cookie, payload: { status: 'formalizada' } });
    expect((await formalizar()).statusCode).toBe(409);
    await prisma.client.update({ where: { id: q.clientId }, data: { correo: 'mano@example.com' } });
    expect((await formalizar()).statusCode).toBe(200);
    const lista = await app.inject({ method: 'GET', url: `/api/quotes/${q.id}/correos`, cookies: cookie });
    expect(lista.json().correos).toEqual([expect.objectContaining({ tipo: 'bienvenida', estado: 'pendiente' })]);
  });
});
