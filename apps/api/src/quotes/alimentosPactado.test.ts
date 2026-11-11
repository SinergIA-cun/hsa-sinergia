import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma, type Prisma } from '@hsa/database';
import { desgloseImportado, type QuoteBreakdown } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, updateQuote, seleccionGuardada, SELECCION_INCLUDE, type Actor } from './service.js';

/**
 * 11-nov-2026: alimentos y servicios en eventos con el precio congelado (precio
 * pactado o ya pasados), la comisión de un servicio del evento (el grupo musical)
 * y la comisión en monto de un paquete que vino del BI.
 */

const LLAVE = 'c'.repeat(64);
let app: FastifyInstance;
let admin: Actor;
let cookie: Record<string, string>;
let arcosId: string;
let bodaId: string;
let paqueteId: string;
let paqueteClave: string;
const quotes: string[] = [];

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE } });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'admin1234' } });
  const c = login.cookies[0]!;
  cookie = { [c.name]: c.value };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.cargoEvento.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.codigoEvento.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await prisma.banquetero.deleteMany({ where: { nombre: { startsWith: 'Agencia Ligada Prueba' } } });
  await app.close();
});

let semana = 0;
const sabado = (anio = 2066) => new Date(Date.UTC(anio, 0, 2 + 7 * semana++)).toISOString().slice(0, 10);

async function nuevo(fecha: string) {
  const q = await createQuote(
    prisma,
    { fecha, invitados: 150, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Alimentos Prueba', telefono: '5514141414' } },
    admin,
  );
  quotes.push(q.id);
  if (!paqueteId) {
    const p = await prisma.foodPackage.findFirstOrThrow({ where: { eventTypeId: bodaId, priceListId: q.priceListId } });
    paqueteId = p.id;
    paqueteClave = p.clave;
  }
  return q;
}

/** Un evento como los del BI: renta y alimentos pactados, formalizado. */
async function importado(renta: number, otros: number, conPaquete = false) {
  const q = await nuevo(sabado());
  const b = desgloseImportado({ salones: [{ spaceId: arcosId, nombre: 'Arcos' }], rentaTotal: renta, otrosTotal: otros, ivaRate: 0.16 });
  if (conPaquete) {
    const pactado = b.lines.find((l) => l.ref?.tipo === 'pactado')!;
    pactado.ref = { ...pactado.ref!, paqueteClave };
  }
  await prisma.quote.update({
    where: { id: q.id },
    data: { breakdown: b as unknown as Prisma.InputJsonValue, total: renta + otros, rentaTotal: renta, precioPactado: true, status: 'formalizada' },
  });
  return q;
}

const guardada = async (id: string) =>
  seleccionGuardada(await prisma.quote.findUniqueOrThrow({ where: { id }, include: SELECCION_INCLUDE }));
const lineas = (b: unknown) => (b as QuoteBreakdown).lines;

describe('alimentos con el precio congelado', () => {
  it('precio pactado: el paquete se suma y la renta pactada no se mueve', async () => {
    const q = await importado(60_000, 0);
    const editado = await updateQuote(prisma, q.id, { ...(await guardada(q.id)), foodPackageId: paqueteId }, admin);

    expect(editado.rentaTotal).toBe(60_000);
    expect(editado.total).toBeGreaterThan(60_000);
    expect(editado.foodPackageId).toBe(paqueteId);
    expect(lineas(editado.breakdown).filter((l) => l.grupo === 'renta').map((l) => l.monto)).toEqual([60_000]);
    expect(lineas(editado.breakdown).some((l) => l.ref?.tipo === 'alimentos')).toBe(true);

    // Quitarlo regresa al total pactado.
    const sin = await updateQuote(prisma, q.id, { ...(await guardada(q.id)), foodPackageId: undefined }, admin);
    expect(sin.total).toBe(60_000);
  });

  it('editar otra cosa no reprecia nada', async () => {
    const q = await importado(60_000, 20_000);
    const editado = await updateQuote(prisma, q.id, { ...(await guardada(q.id)), festejado: 'Otra persona' }, admin);
    expect(editado.total).toBe(80_000);
    expect(editado.breakdown).toEqual((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).breakdown);
  });

  it('evento que ya pasó: se agrega el paquete y la renta se queda', async () => {
    const q = await nuevo('2024-02-03');
    const editado = await updateQuote(prisma, q.id, { ...(await guardada(q.id)), foodPackageId: paqueteId, invitados: 160 }, admin);
    expect(editado.rentaTotal).toBe(q.rentaTotal);
    expect(editado.total).toBeGreaterThan(q.total);
  });
});

describe('comisión de un servicio del evento', () => {
  it('el grupo musical guarda su proveedor y su comisión, y el BI la ve', async () => {
    const q = await importado(60_000, 0);
    const grupo = { nombre: 'Grupo musical', kind: 'fijo' as const, monto: 23_200, cantidad: 1, proveedor: 'Grupo de prueba', comisionMonto: 2_000 };
    const editado = await updateQuote(prisma, q.id, { ...(await guardada(q.id)), extras: [grupo] }, admin);
    expect(editado.total).toBe(60_000 + 23_200);

    // Sobrevive a un recálculo desde lo guardado (arrastrar la fecha usa esto).
    expect((await guardada(q.id)).extras[0]).toMatchObject({ proveedor: 'Grupo de prueba', comisionMonto: 2_000 });
    // Y la pantalla lo recibe al abrir el evento: si no, la siguiente edición lo borraría.
    const abierto = await app.inject({ method: 'GET', url: `/api/quotes/${q.id}`, cookies: cookie });
    expect(abierto.json().quote.extras[0]).toMatchObject({ proveedor: 'Grupo de prueba', comisionMonto: 2_000 });

    const r = await app.inject({ method: 'GET', url: `/api/bi/eventos?ids=${q.id}`, headers: { 'x-api-key': LLAVE } });
    const renglon = r.json().datos[0].desglose.find((x: { tipo: string }) => x.tipo === 'servicioEvento');
    expect(renglon.proveedor).toEqual({ clave: null, nombre: 'Grupo de prueba' });
    expect(renglon.comision).toMatchObject({ monto: 2_000, porcentaje: 10 }); // 2,000 de 20,000 sin IVA
  });
});

describe('comisión de un paquete que vino del BI', () => {
  const poner = (id: string, comisionMonto: number | null) =>
    app.inject({ method: 'PATCH', url: `/api/quotes/${id}/comision-paquete`, cookies: cookie, payload: { comisionMonto } });

  it('se captura en monto, queda en la bitácora y el BI la ve', async () => {
    const q = await importado(60_000, 100_000, true);
    expect((await poner(q.id, 15_000)).statusCode).toBe(200);

    const r = await app.inject({ method: 'GET', url: `/api/bi/eventos?ids=${q.id}`, headers: { 'x-api-key': LLAVE } });
    const renglon = r.json().datos[0].desglose.find((x: { tipo: string }) => x.tipo === 'pactado');
    expect(renglon.comision.monto).toBe(15_000);
    const log = await prisma.activityLog.findFirst({ where: { quoteId: q.id, descripcion: { contains: 'Comisión de la agencia por el paquete' } } });
    expect(log).not.toBeNull();
  });

  it('no puede pasar de lo pactado, y un evento sin paquete del BI la rechaza', async () => {
    const conPaquete = await importado(60_000, 10_000, true);
    expect((await poner(conPaquete.id, 10_001)).statusCode).toBe(400);
    const sinPaquete = await importado(60_000, 10_000);
    expect((await poner(sinPaquete.id, 1_000)).statusCode).toBe(409);
  });
});

describe('comisión de un cargo del punto de venta', () => {
  it('al grupo musical cargado como "Otro" se le pone proveedor y comisión después, sin mover el total', async () => {
    const q = await importado(163_500, 0);
    const alta = await app.inject({
      method: 'POST', url: `/api/quotes/${q.id}/cargos`, cookies: cookie,
      payload: { producto: 'otro', cantidad: 1, precioUnitario: 41_528, descripcion: 'GRUPO MUSICAL', fecha: '2066-01-10' },
    });
    expect(alta.statusCode).toBe(201);
    const cargoId = alta.json().cargo.id as string;
    const totalAntes = (await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).total;

    const r = await app.inject({
      method: 'PATCH', url: `/api/quotes/${q.id}/cargos/${cargoId}/comision`, cookies: cookie,
      payload: { proveedor: 'Grupo de prueba', comisionPct: 15 },
    });
    expect(r.statusCode).toBe(200);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).total).toBe(totalAntes);

    const bi = (path: string) => app.inject({ method: 'GET', url: `/api/bi/${path}?ids=${q.id}`, headers: { 'x-api-key': LLAVE } });
    const cargo = (await bi('cargos')).json().datos.find((c: { id: string }) => c.id === cargoId);
    expect(cargo.proveedor).toBe('Grupo de prueba');
    expect(cargo.comision).toMatchObject({ porcentaje: 15, monto: 5_370 }); // 15% de 35,800 sin IVA
    const renglon = (await bi('eventos')).json().datos[0].desglose.find((x: { tipo: string }) => x.tipo === 'cargoContrato');
    expect(renglon.proveedor).toEqual({ clave: null, nombre: 'Grupo de prueba' });
    expect(renglon.comision).toMatchObject({ porcentaje: 15, monto: 5_370 });

    // Las dos formas a la vez no.
    const ambas = await app.inject({
      method: 'PATCH', url: `/api/quotes/${q.id}/cargos/${cargoId}/comision`, cookies: cookie,
      payload: { comisionPct: 10, comisionMonto: 1_000 },
    });
    expect(ambas.statusCode).toBe(400);
  });
});

describe('proveedor que es de Prof. Evento', () => {
  it('el servicio y el cargo le llegan al BI con la agencia y, sin comisión capturada, la de su ficha', async () => {
    const nombre = `Agencia Ligada Prueba ${Date.now()}`;
    const ag = await prisma.banquetero.create({ data: { nombre, telefono: '5500000001', comisionPct: 12 } });
    const q = await importado(151_000, 0);
    // Tecleado con otras mayúsculas: igual liga.
    const alimentos = { nombre: 'ALIMENTOS', kind: 'fijo' as const, monto: 116_000, cantidad: 1, proveedor: nombre.toUpperCase() };
    await updateQuote(prisma, q.id, { ...(await guardada(q.id)), extras: [alimentos] }, admin);
    const cargo = await app.inject({
      method: 'POST', url: `/api/quotes/${q.id}/cargos`, cookies: cookie,
      payload: { producto: 'otro', cantidad: 1, precioUnitario: 11_600, descripcion: 'Extra', fecha: '2066-01-10', proveedor: nombre, comisionMonto: 500 },
    });
    expect(cargo.statusCode).toBe(201);

    const bi = (path: string) => app.inject({ method: 'GET', url: `/api/bi/${path}?ids=${q.id}`, headers: { 'x-api-key': LLAVE } });
    const desglose = (await bi('eventos')).json().datos[0].desglose;
    const servicio = desglose.find((x: { tipo: string }) => x.tipo === 'servicioEvento');
    expect(servicio.agencia).toMatchObject({ clave: ag.id, nombre });
    expect(servicio.comision).toMatchObject({ porcentaje: 12, monto: 12_000 }); // 12% de 100,000 sin IVA
    const enContrato = desglose.find((x: { tipo: string }) => x.tipo === 'cargoContrato');
    expect(enContrato.agencia).toMatchObject({ clave: ag.id });
    expect(enContrato.comision).toMatchObject({ monto: 500 });
    const enCargos = (await bi('cargos')).json().datos[0];
    expect(enCargos.agencia).toMatchObject({ clave: ag.id, nombre });
  });
});
