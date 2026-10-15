import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { importarLote, type EventoBI } from './importar.js';
import { ajustarPrecioPactado } from '../quotes/precioPactado.js';

/** El paquete de los eventos importados y la agencia del paquete (BI #4, 15-oct-2026). */

const LLAVE_IMPORTAR = 'i'.repeat(64);
const LLAVE_LEER = 'l'.repeat(64);
let app: FastifyInstance;
let cookie: Record<string, string>;
let adminId: string;
let clave: string;
let agenciaId: string;
const idsBI: string[] = [];

let semana = 0;
const sabado = () => new Date(Date.UTC(2061, 0, 1 + 7 * semana++)).toISOString().slice(0, 10);

async function importado(over: Partial<EventoBI> = {}) {
  const idBI = `PQ-${randomUUID().slice(0, 8)}`;
  idsBI.push(idBI);
  await importarLote(prisma, {
    eventos: [
      {
        idBI,
        fechaContratacion: '2026-02-02',
        fechaEvento: sabado(),
        tipoEvento: 'Boda',
        salones: ['Arcos'],
        invitados: 200,
        cliente: { nombre: 'Paquete Importado', telefono: `55${Math.floor(Math.random() * 1e8)}` },
        renta: { total: 90_000 },
        otros: { total: 116_000 },
        pagos: [],
        ...over,
      },
    ],
  });
  return prisma.quote.findUniqueOrThrow({ where: { importadoBI: idBI } });
}

const post = (ruta: string, payload: unknown) =>
  app.inject({ method: 'POST', url: `/api/bi/${ruta}/paquetes`, headers: { 'x-api-key': LLAVE_IMPORTAR }, payload });

async function renglonPactadoBI(quoteId: string) {
  const r = await app.inject({ method: 'GET', url: '/api/bi/eventos?limit=500&desde=2061-01-01&hasta=2061-12-31', headers: { 'x-api-key': LLAVE_LEER } });
  const ev = (r.json().datos as { id: string; desglose: { tipo: string }[] }[]).find((e) => e.id === quoteId);
  return ev?.desglose.find((d) => d.tipo === 'pactado') as Record<string, unknown> | undefined;
}

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE_LEER, BI_IMPORT_API_KEY: LLAVE_IMPORTAR } });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  adminId = u.id;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'admin1234' } });
  const c = login.cookies[0]!;
  cookie = { [c.name]: c.value };
  clave = (await prisma.foodPackage.findFirstOrThrow({ select: { clave: true } })).clave;
  agenciaId = (await prisma.banquetero.create({ data: { nombre: `Agencia Paquete ${randomUUID().slice(0, 6)}` } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { importadoBI: { in: idsBI } }, select: { id: true, clientId: true } });
  const ids = qs.map((q) => q.id);
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: ids } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: ids } } });
  await prisma.quote.deleteMany({ where: { id: { in: ids } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await prisma.banquetero.deleteMany({ where: { id: agenciaId } });
  await app.close();
});

describe('conciliar e importar el paquete de los importados', () => {
  it('conciliar no escribe; importar pone clave y comisión sin mover el monto; repetir no cambia nada', async () => {
    const q = await importado();
    const lote = { paquetes: [{ idBI: q.importadoBI, clave, comision: { monto: 19_200 } }] };

    const c = await post('conciliar', lote);
    expect(c.statusCode).toBe(200);
    expect(c.json().resultados[0]).toMatchObject({ estado: 'aplicar', quoteId: q.id, comision: 19_200 });
    expect(await renglonPactadoBI(q.id)).toMatchObject({ clave: null });

    const i = await post('importar', lote);
    expect(i.json().resultados[0]).toMatchObject({ estado: 'aplicado' });
    const despues = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(despues.total).toBe(q.total);
    const r = await renglonPactadoBI(q.id);
    expect(r).toMatchObject({ clave, total: 116_000, comision: { monto: 19_200 }, agencia: null });

    expect((await post('importar', lote)).json().resultados[0]).toMatchObject({ estado: 'sinCambios' });
  });

  it('reporta lo que no puede aplicar: idBI desconocido, clave que no existe, cancelado, comisión mayor al monto', async () => {
    const q = await importado();
    const cancelado = await importado();
    await prisma.quote.update({ where: { id: cancelado.id }, data: { status: 'cancelada' } });
    const r = await post('importar', {
      paquetes: [
        { idBI: 'NO-EXISTE-PQ', clave },
        { idBI: q.importadoBI, clave: 'clave-que-no-existe' },
        { idBI: cancelado.importadoBI, clave },
        { idBI: q.importadoBI, clave, comision: { monto: 200_000 } },
      ],
    });
    expect(r.json().resultados.map((x: { estado: string }) => x.estado)).toEqual(['noEncontrado', 'claveDesconocida', 'cancelado', 'comisionInvalida']);
  });

  it('sin la llave de importar no existe', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/bi/importar/paquetes', headers: { 'x-api-key': LLAVE_LEER }, payload: { paquetes: [] } });
    expect(r.statusCode).toBe(401);
  });
});

describe('la agencia del paquete', () => {
  it('se escoge de la lista, no vuelve cliente a la agencia, y la lee el BI', async () => {
    const q = await importado();
    // Sin paquete no hay agencia que poner.
    const sinPaquete = await app.inject({ method: 'PATCH', url: `/api/quotes/${q.id}/agencia`, cookies: cookie, payload: { agenciaId } });
    expect(sinPaquete.statusCode).toBe(409);

    await post('importar', { paquetes: [{ idBI: q.importadoBI, clave }] });
    const r = await app.inject({ method: 'PATCH', url: `/api/quotes/${q.id}/agencia`, cookies: cookie, payload: { agenciaId } });
    expect(r.statusCode).toBe(200);
    const despues = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(despues).toMatchObject({ agenciaId, banqueteroId: null });
    expect(await renglonPactadoBI(q.id)).toMatchObject({ clave, agencia: { clave: agenciaId } });

    const otra = await app.inject({ method: 'PATCH', url: `/api/quotes/${q.id}/agencia`, cookies: cookie, payload: { agenciaId: 'no-existe' } });
    expect(otra.statusCode).toBe(400);
    const detalle = await app.inject({ method: 'GET', url: `/api/quotes/${q.id}`, cookies: cookie });
    expect(detalle.json().paquete).toMatchObject({ clave, origen: 'pactado' });
    expect(detalle.json().quote.agencia).toMatchObject({ id: agenciaId });
  });

  it('ajustar el precio pactado conserva el paquete', async () => {
    const q = await importado();
    await post('importar', { paquetes: [{ idBI: q.importadoBI, clave, comision: { monto: 5_000 } }] });
    await ajustarPrecioPactado(prisma, q.id, { renta: 95_000, otros: 120_000, motivo: 'Subió el banquete' }, { id: adminId, role: 'admin' });
    expect(await renglonPactadoBI(q.id)).toMatchObject({ clave, total: 120_000, comision: { monto: 5_000 } });
  });
});
