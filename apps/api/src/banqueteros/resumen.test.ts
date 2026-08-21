import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createQuote, softDeleteQuote, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { registrarDeposito, asignarDeposito } from './cuenta.js';
import { crearApartado, cancelarApartado } from './apartados.js';
import { resumenBanqueteros } from './resumen.js';

/**
 * El resumen que alimenta la lista de admin y el tablero.
 *
 * Lo que se fija aquí es lo que las dos pantallas prometen: el saldo sin asignar
 * por banquetero (dinero de la hacienda sin destino), cuántos apartados vivos
 * tiene y cuántos vencen pronto. Si esto se desalinea, la lista dice un número y
 * la ficha otro.
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-resumen-test-' + randomUUID()));

let app: FastifyInstance;
let actor: Actor;
let arcosId: string;
let eventTypeId: string;
let conSaldoId: string;
let apartadorId: string;
const ventasEmail = `ventas-resumen-${randomUUID()}@haciendasanandres.com.mx`;
let ventasId: string;
const quotes: string[] = [];
const clients: string[] = [];
const banqueteros: string[] = [];

/** Fechas de 2035: aisladas de las demás suites. */
const PRIMER_SABADO = '2035-01-06';
let sabadoSeq = 0;
function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

/** El "hoy" de las pruebas del vencimiento: fijo, para que no dependan del reloj. */
const HOY = new Date('2035-06-01T00:00:00.000Z');
const dentroDeLaVentana = '2035-06-20'; // < 30 días de HOY
const fueraDeLaVentana = '2035-12-01'; // > 30 días de HOY

async function evento(deQuien: string) {
  const q = await createQuote(
    prisma,
    {
      fecha: siguienteSabado(),
      invitados: 200,
      spaceIds: [arcosId],
      eventTypeId,
      banqueteroId: deQuien,
      client: { nombre: 'Cliente del resumen' },
    },
    actor,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  const v = await prisma.user.create({
    data: {
      nombre: 'Vendedora del resumen',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventasId = v.id;
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } }))!.id;
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
  const [a, b] = await Promise.all([
    prisma.banquetero.create({ data: { nombre: `Resumen saldo ${randomUUID().slice(0, 6)}` } }),
    prisma.banquetero.create({ data: { nombre: `Resumen apartados ${randomUUID().slice(0, 6)}` } }),
  ]);
  conSaldoId = a.id;
  apartadorId = b.id;
  banqueteros.push(a.id, b.id);
});

afterAll(async () => {
  await prisma.apartadoFecha.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.pagoBanquetero.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: banqueteros } } });
  await prisma.user.delete({ where: { id: ventasId } });
  await app.close();
});

const mio = (r: Awaited<ReturnType<typeof resumenBanqueteros>>, id: string) =>
  r.banqueteros.find((b) => b.banqueteroId === id)!;

describe('resumen de banqueteros', () => {
  it('reporta el saldo sin asignar y los eventos vivos de cada banquetero', async () => {
    const a = await evento(conSaldoId);
    const dep = await registrarDeposito(
      prisma,
      storage,
      conSaldoId,
      { monto: 100_000, metodo: 'transferencia', fecha: '2035-05-02' },
      actor,
    );
    await asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: a.id, monto: 40_000 }] }, actor);

    const r = await resumenBanqueteros(prisma, { hoy: HOY });
    const fila = mio(r, conSaldoId);
    expect(fila.depositado).toBe(100_000);
    expect(fila.saldoSinAsignar).toBe(60_000);
    expect(fila.eventos).toBe(1);
    // El total es exactamente la suma de los renglones: si divergen, la lista y
    // el tablero dirían números distintos del mismo dinero.
    expect(r.totalSinAsignar).toBe(r.banqueteros.reduce((s, b) => s + b.saldoSinAsignar, 0));
  });

  it('una cotización en papelera deja de contar como evento', async () => {
    const q = await evento(conSaldoId);
    const antes = mio(await resumenBanqueteros(prisma, { hoy: HOY }), conSaldoId).eventos;
    await softDeleteQuote(prisma, q.id, actor);
    const despues = mio(await resumenBanqueteros(prisma, { hoy: HOY }), conSaldoId).eventos;
    expect(despues).toBe(antes - 1);
  });

  it('cuenta los apartados vivos y separa los que vencen en 30 días', async () => {
    const cerca = await crearApartado(
      prisma,
      apartadorId,
      { fechaEvento: siguienteSabado(), spaceIds: [arcosId], vence: dentroDeLaVentana },
      actor,
    );
    await crearApartado(
      prisma,
      apartadorId,
      { fechaEvento: siguienteSabado(), spaceIds: [arcosId], vence: fueraDeLaVentana },
      actor,
    );

    const r = await resumenBanqueteros(prisma, { hoy: HOY });
    const fila = mio(r, apartadorId);
    expect(fila.apartadosVivos).toBe(2);
    expect(fila.apartadosPorVencer).toBe(1);
    // El más próximo manda: es con lo que la lista ordena por urgencia.
    expect(fila.proximoVencimientoISO).toBe(new Date(`${dentroDeLaVentana}T00:00:00.000Z`).toISOString());

    const pendiente = r.apartados.find((a) => a.apartadoId === cerca.apartado.id)!;
    expect(pendiente.banqueteroId).toBe(apartadorId);
    expect(pendiente.diasParaVencer).toBe(19);
  });

  it('un apartado cancelado deja de contar', async () => {
    const { apartado } = await crearApartado(
      prisma,
      apartadorId,
      { fechaEvento: siguienteSabado(), spaceIds: [arcosId], vence: fueraDeLaVentana },
      actor,
    );
    const antes = mio(await resumenBanqueteros(prisma, { hoy: HOY }), apartadorId).apartadosVivos;
    await cancelarApartado(prisma, apartado.id, { motivo: 'ya no lo quiso' }, actor);
    const r = await resumenBanqueteros(prisma, { hoy: HOY });
    expect(mio(r, apartadorId).apartadosVivos).toBe(antes - 1);
    expect(r.apartados.some((a) => a.apartadoId === apartado.id)).toBe(false);
  });

  it('un apartado vencido deja de contar', async () => {
    const { apartado } = await crearApartado(
      prisma,
      apartadorId,
      { fechaEvento: siguienteSabado(), spaceIds: [arcosId], vence: '2035-05-01' },
      actor,
    );
    // Vence antes de HOY: sigue en la tabla pero ya no bloquea ni cuenta.
    const r = await resumenBanqueteros(prisma, { hoy: HOY });
    expect(r.apartados.some((a) => a.apartadoId === apartado.id)).toBe(false);
  });

  it('la ruta /banqueteros/resumen no se confunde con un id y la ve ventas', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ventasEmail, password: 'ventas1234' },
    });
    const c = login.cookies[0]!;
    const res = await app.inject({
      method: 'GET',
      url: '/api/banqueteros/resumen',
      cookies: { [c.name]: c.value },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { banqueteros: { banqueteroId: string }[]; totalSinAsignar: number };
    expect(body.banqueteros.some((b) => b.banqueteroId === conSaldoId)).toBe(true);
    expect(typeof body.totalSinAsignar).toBe('number');
  });

  it('sin sesión no se ve', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/banqueteros/resumen' });
    expect(res.statusCode).toBe(401);
  });
});
