import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { cotizacionesDesplazadas } from './empalmes.js';
import type { Actor } from './service.js';

let app: FastifyInstance;
let adminActor: Actor;
let ventasActor: Actor;
let eventTypeId: string;
let cupulaId: string;
let arcosId: string;

const ventasEmail = `ventas-empalmes-${randomUUID()}@haciendasanandres.com.mx`;
const quotes: string[] = [];
const clients: string[] = [];

// Año propio de este archivo: `cotizacionesDesplazadas` barre la base sin filtro
// de fecha, así que compartir fechas con otro archivo de test contaminaría los
// resultados. Aun así cada aserción filtra por los ids creados en su propio test.
const ANIO = 2033;

type EstadoCotizacion = 'borrador' | 'enviada' | 'aceptada' | 'formalizada' | 'complementada' | 'liquidada' | 'vencida';

/**
 * Cotización creada directo en la base, sin pasar por `createQuote`.
 *
 * A propósito: `createQuote` rechaza con 409 cotizar sobre un espacio ya
 * comprometido, que es justo el escenario que hay que montar aquí.
 */
async function crearCotizacion(opts: {
  fecha: string;
  spaceIds: string[];
  status?: EstadoCotizacion;
  ownerId?: string;
  deletedAt?: Date | null;
  nombre?: string;
}) {
  const client = await prisma.client.create({
    data: { nombre: opts.nombre ?? `Empalme ${randomUUID().slice(0, 8)}` },
  });
  clients.push(client.id);
  const quote = await prisma.quote.create({
    data: {
      clientId: client.id,
      eventTypeId,
      fechaEvento: new Date(`${opts.fecha}T00:00:00.000Z`),
      invitados: 200,
      spaceIds: opts.spaceIds,
      breakdown: { lines: [] },
      total: 100_000,
      rentaTotal: 100_000,
      status: opts.status ?? 'borrador',
      publicToken: randomUUID().replace(/-/g, ''),
      createdById: opts.ownerId ?? adminActor.id,
      deletedAt: opts.deletedAt ?? null,
    },
  });
  quotes.push(quote.id);
  return quote;
}

/** Filtra el barrido global a los ids creados por el test que llama. */
function soloDeEsteTest<T extends { id: string }>(items: T[], ids: string[]): T[] {
  return items.filter((x) => ids.includes(x.id));
}

async function adminAuthCookie() {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
  });
  const cookie = login.cookies[0]!;
  return { [cookie.name]: cookie.value };
}

beforeAll(async () => {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  adminActor = { id: admin!.id, role: 'admin' };
  const ventas = await prisma.user.create({
    data: {
      nombre: 'Vendedora de empalmes',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventasActor = { id: ventas.id, role: 'ventas' };
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
  cupulaId = (await prisma.space.findFirst({ where: { nombre: 'Jardín La Cúpula' } }))!.id;
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } }))!.id;
  app = await buildServer({ config: loadConfig() });
  await app.ready();
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.user.delete({ where: { id: ventasActor.id } });
  await app.close();
});

describe('cotizacionesDesplazadas', () => {
  it('lista las cotizaciones vivas cuya fecha y espacio ya fueron apartados por otro', async () => {
    const bloqueante = await crearCotizacion({
      fecha: `${ANIO}-03-20`,
      spaceIds: [cupulaId],
      status: 'formalizada',
      nombre: 'Ganó la fecha',
    });
    const desplazada = await crearCotizacion({
      fecha: `${ANIO}-03-20`,
      spaceIds: [cupulaId],
      status: 'borrador',
      nombre: 'Perdió la fecha',
    });

    const r = soloDeEsteTest(await cotizacionesDesplazadas(prisma, adminActor), [bloqueante.id, desplazada.id]);
    expect(r.map((x) => x.id)).toEqual([desplazada.id]);
    expect(r[0]!.bloqueadaPor.id).toBe(bloqueante.id);
    expect(r[0]!.bloqueadaPor.clienteNombre).toBe('Ganó la fecha');
    expect(r[0]!.clienteNombre).toBe('Perdió la fecha');
  });

  it('no lista la que sí ganó la fecha', async () => {
    const ganadora = await crearCotizacion({ fecha: `${ANIO}-03-21`, spaceIds: [cupulaId], status: 'formalizada' });
    const r = soloDeEsteTest(await cotizacionesDesplazadas(prisma, adminActor), [ganadora.id]);
    expect(r).toHaveLength(0);
  });

  it('otro espacio el mismo día no es empalme', async () => {
    const a = await crearCotizacion({ fecha: `${ANIO}-03-22`, spaceIds: [cupulaId], status: 'formalizada' });
    const b = await crearCotizacion({ fecha: `${ANIO}-03-22`, spaceIds: [arcosId], status: 'borrador' });
    const r = soloDeEsteTest(await cotizacionesDesplazadas(prisma, adminActor), [a.id, b.id]);
    expect(r).toHaveLength(0);
  });

  it('un vendedor solo ve las suyas, aunque quien apartó sea de alguien más', async () => {
    const bloqueante = await crearCotizacion({
      fecha: `${ANIO}-03-23`,
      spaceIds: [cupulaId],
      status: 'formalizada',
    }); // del admin
    const ajena = await crearCotizacion({ fecha: `${ANIO}-03-23`, spaceIds: [cupulaId], status: 'borrador' });
    const propia = await crearCotizacion({
      fecha: `${ANIO}-03-23`,
      spaceIds: [cupulaId],
      status: 'borrador',
      ownerId: ventasActor.id,
    });

    const ids = [bloqueante.id, ajena.id, propia.id];
    const suyas = soloDeEsteTest(await cotizacionesDesplazadas(prisma, ventasActor), ids);
    expect(suyas.map((x) => x.id)).toEqual([propia.id]);

    // El admin ve las dos desplazadas, sin importar de quién sean.
    const todas = soloDeEsteTest(await cotizacionesDesplazadas(prisma, adminActor), ids);
    expect(todas.map((x) => x.id).sort()).toEqual([ajena.id, propia.id].sort());
  });

  it('las de la papelera no cuentan', async () => {
    const bloqueante = await crearCotizacion({ fecha: `${ANIO}-03-24`, spaceIds: [cupulaId], status: 'formalizada' });
    const enPapelera = await crearCotizacion({
      fecha: `${ANIO}-03-24`,
      spaceIds: [cupulaId],
      status: 'borrador',
      deletedAt: new Date(),
    });
    const r = soloDeEsteTest(await cotizacionesDesplazadas(prisma, adminActor), [bloqueante.id, enPapelera.id]);
    expect(r).toHaveLength(0);
  });

  it('una bloqueante en la papelera ya no desplaza a nadie', async () => {
    const bloqueante = await crearCotizacion({
      fecha: `${ANIO}-03-26`,
      spaceIds: [cupulaId],
      status: 'formalizada',
      deletedAt: new Date(),
    });
    const viva = await crearCotizacion({ fecha: `${ANIO}-03-26`, spaceIds: [cupulaId], status: 'borrador' });
    const r = soloDeEsteTest(await cotizacionesDesplazadas(prisma, adminActor), [bloqueante.id, viva.id]);
    expect(r).toHaveLength(0);
  });

  it('las vencidas no cuentan', async () => {
    const bloqueante = await crearCotizacion({ fecha: `${ANIO}-03-25`, spaceIds: [cupulaId], status: 'formalizada' });
    const vencida = await crearCotizacion({ fecha: `${ANIO}-03-25`, spaceIds: [cupulaId], status: 'vencida' });
    const r = soloDeEsteTest(await cotizacionesDesplazadas(prisma, adminActor), [bloqueante.id, vencida.id]);
    expect(r).toHaveLength(0);
  });

  it('una complementada y una liquidada también desplazan', async () => {
    const comp = await crearCotizacion({ fecha: `${ANIO}-04-04`, spaceIds: [cupulaId], status: 'complementada' });
    const viva1 = await crearCotizacion({ fecha: `${ANIO}-04-04`, spaceIds: [cupulaId], status: 'enviada' });
    const liq = await crearCotizacion({ fecha: `${ANIO}-04-11`, spaceIds: [arcosId], status: 'liquidada' });
    const viva2 = await crearCotizacion({ fecha: `${ANIO}-04-11`, spaceIds: [arcosId], status: 'aceptada' });

    const r = soloDeEsteTest(await cotizacionesDesplazadas(prisma, adminActor), [
      comp.id, viva1.id, liq.id, viva2.id,
    ]);
    expect(r.map((x) => x.id).sort()).toEqual([viva1.id, viva2.id].sort());
  });
});

describe('GET /api/quotes/desplazadas', () => {
  it('responde la lista, no un 404 de /quotes/:id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/quotes/desplazadas',
      cookies: await adminAuthCookie(),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  it('devuelve el empalme recién creado con su bloqueante', async () => {
    const bloqueante = await crearCotizacion({
      fecha: `${ANIO}-05-14`,
      spaceIds: [arcosId],
      status: 'formalizada',
      nombre: 'Apartó Arcos',
    });
    const desplazada = await crearCotizacion({ fecha: `${ANIO}-05-14`, spaceIds: [arcosId], status: 'enviada' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/quotes/desplazadas',
      cookies: await adminAuthCookie(),
    });
    expect(res.statusCode).toBe(200);
    const mio = (res.json().items as { id: string; bloqueadaPor: { id: string; clienteNombre: string } }[]).find(
      (x) => x.id === desplazada.id,
    );
    expect(mio).toBeDefined();
    expect(mio!.bloqueadaPor.id).toBe(bloqueante.id);
    expect(mio!.bloqueadaPor.clienteNombre).toBe('Apartó Arcos');
  });

  it('sin sesión responde 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/quotes/desplazadas' });
    expect(res.statusCode).toBe(401);
  });
});
