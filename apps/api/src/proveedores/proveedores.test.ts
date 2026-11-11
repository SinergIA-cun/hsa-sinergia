import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma, type Prisma } from '@hsa/database';
import { desgloseImportado } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createQuote, updateQuote, seleccionGuardada, SELECCION_INCLUDE, type Actor } from '../quotes/service.js';

/**
 * Apartado "Proveedores" (11-nov-2026): ficha, productos con comisión pactada, y
 * el producto escogido al vender un servicio del evento o un cargo.
 */

const LLAVE = 'd'.repeat(64);
const sufijo = randomUUID().slice(0, 8);
const ventasEmail = `ventas-prov-${sufijo}@haciendasanandres.com.mx`;
let app: FastifyInstance;
let admin: Actor;
let ventasId: string;
let cookieAdmin: Record<string, string>;
let cookieVentas: Record<string, string>;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];
const proveedores: string[] = [];

async function entrar(email: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const c = r.cookies[0]!;
  return { [c.name]: c.value };
}

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE } });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const v = await prisma.user.create({
    data: { nombre: 'Ventas proveedores', email: ventasEmail, passwordHash: await hashPassword('ventas1234'), role: 'ventas' },
  });
  ventasId = v.id;
  cookieAdmin = await entrar(u.email, 'admin1234');
  cookieVentas = await entrar(ventasEmail, 'ventas1234');
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
  await prisma.productoProveedor.deleteMany({ where: { proveedorId: { in: proveedores } } });
  await prisma.proveedor.deleteMany({ where: { id: { in: proveedores } } });
  await prisma.user.delete({ where: { id: ventasId } });
  await app.close();
});

const pedir = (method: 'GET' | 'POST' | 'PATCH', url: string, cookies: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url, cookies, ...(payload ? { payload: payload as Record<string, unknown> } : {}) });

async function nuevoProveedor(nombre: string, extra: Record<string, unknown> = {}) {
  const r = await pedir('POST', '/api/admin/proveedores', cookieAdmin, { nombre, ...extra });
  expect(r.statusCode).toBe(201);
  const id = r.json().proveedor.id as string;
  proveedores.push(id);
  return id;
}

async function nuevoProducto(proveedorId: string, payload: Record<string, unknown>) {
  const r = await pedir('POST', `/api/admin/proveedores/${proveedorId}/productos`, cookieAdmin, payload);
  expect(r.statusCode).toBe(201);
  return r.json().producto as { id: string };
}

describe('ficha y productos', () => {
  it('un admin da de alta al proveedor con su ficha y sus productos; ventas los ve pero no edita', async () => {
    const id = await nuevoProveedor(`Flores prueba ${sufijo}`, {
      giro: 'Flores', contacto: 'Ana', telefono: '5511112222', correo: 'flores@example.com', rfc: 'xaxx010101000', notas: '',
    });
    await nuevoProducto(id, { nombre: 'Centro de mesa', precio: 1_160, comisionPct: 10 });
    await nuevoProducto(id, { nombre: 'Arco floral', comisionMonto: 1_500 });

    const lista = await pedir('GET', '/api/proveedores', cookieVentas);
    expect(lista.statusCode).toBe(200);
    const p = lista.json().proveedores.find((x: { id: string }) => x.id === id);
    expect(p).toMatchObject({ giro: 'Flores', contacto: 'Ana', rfc: 'XAXX010101000', notas: null });
    expect(p.productos.map((x: { nombre: string }) => x.nombre)).toEqual(['Arco floral', 'Centro de mesa']);

    expect((await pedir('POST', '/api/admin/proveedores', cookieVentas, { nombre: `Otro ${sufijo}` })).statusCode).toBe(403);
    expect((await pedir('POST', `/api/admin/proveedores/${id}/productos`, cookieVentas, { nombre: 'X' })).statusCode).toBe(403);
  });

  it('el producto no se repite, la comisión es % o monto, y cambiar de forma limpia la otra', async () => {
    const id = await nuevoProveedor(`Sonido prueba ${sufijo}`, { giro: 'Sonido' });
    const prod = await nuevoProducto(id, { nombre: 'Sonido básico', comisionPct: 12 });
    expect((await pedir('POST', `/api/admin/proveedores/${id}/productos`, cookieAdmin, { nombre: 'sonido BÁSICO' })).statusCode).not.toBe(201);
    expect((await pedir('POST', `/api/admin/proveedores/${id}/productos`, cookieAdmin, { nombre: 'Doble', comisionPct: 5, comisionMonto: 100 })).statusCode).toBe(400);

    const cambio = await pedir('PATCH', `/api/admin/proveedores/${id}/productos/${prod.id}`, cookieAdmin, { comisionMonto: 800 });
    expect(cambio.statusCode).toBe(200);
    expect(cambio.json().producto).toMatchObject({ comisionPct: null, comisionMonto: 800 });
    const baja = await pedir('PATCH', `/api/admin/proveedores/${id}/productos/${prod.id}`, cookieAdmin, { activo: false });
    expect(baja.json().producto.activo).toBe(false);
  });

  it('un correo mal escrito se rechaza', async () => {
    expect((await pedir('POST', '/api/admin/proveedores', cookieAdmin, { nombre: `Mal correo ${sufijo}`, correo: 'no-es-correo' })).statusCode).toBe(400);
  });
});

describe('al vender', () => {
  let semana = 0;
  async function evento() {
    const fecha = new Date(Date.UTC(2067, 2, 5 + 7 * semana++)).toISOString().slice(0, 10);
    const q = await createQuote(
      prisma,
      { fecha, invitados: 150, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Proveedores Prueba', telefono: '5515151515' } },
      admin,
    );
    quotes.push(q.id);
    const b = desgloseImportado({ salones: [{ spaceId: arcosId, nombre: 'Arcos' }], rentaTotal: 60_000, otrosTotal: 0, ivaRate: 0.16 });
    await prisma.quote.update({
      where: { id: q.id },
      data: { breakdown: b as unknown as Prisma.InputJsonValue, total: 60_000, rentaTotal: 60_000, precioPactado: true, status: 'formalizada' },
    });
    return q;
  }
  const guardada = async (id: string) => seleccionGuardada(await prisma.quote.findUniqueOrThrow({ where: { id }, include: SELECCION_INCLUDE }));
  const bi = (path: string, id: string) => app.inject({ method: 'GET', url: `/api/bi/${path}?ids=${id}`, headers: { 'x-api-key': LLAVE } });

  it('un servicio del evento con producto de un proveedor: se liga por su id y el BI lo recibe así', async () => {
    const provId = await nuevoProveedor(`DJ prueba ${sufijo}`, { giro: 'DJ' });
    const prod = await nuevoProducto(provId, { nombre: 'DJ 5 horas', precio: 23_200, comisionPct: 15 });
    const q = await evento();
    // Solo el producto: el proveedor y su nombre los pone el servidor.
    const servicio = { nombre: 'DJ 5 horas', kind: 'fijo' as const, monto: 23_200, cantidad: 1, productoProveedorId: prod.id, comisionPct: 15 };
    const editado = await updateQuote(prisma, q.id, { ...(await guardada(q.id)), extras: [servicio] }, admin);
    expect(editado.total).toBe(60_000 + 23_200);
    expect((await guardada(q.id)).extras[0]).toMatchObject({ proveedorId: provId, productoProveedorId: prod.id, proveedor: `DJ prueba ${sufijo}` });

    const renglon = (await bi('eventos', q.id)).json().datos[0].desglose.find((x: { tipo: string }) => x.tipo === 'servicioEvento');
    expect(renglon.proveedor).toEqual({ clave: provId, nombre: `DJ prueba ${sufijo}` });
    expect(renglon.productoProveedor).toEqual({ clave: prod.id, nombre: 'DJ 5 horas' });
    expect(renglon.comision).toMatchObject({ porcentaje: 15, monto: 3_000 }); // 15% de 20,000 sin IVA

    const catalogos = (await app.inject({ method: 'GET', url: '/api/bi/catalogos', headers: { 'x-api-key': LLAVE } })).json();
    const enCatalogo = (catalogos.datos ?? catalogos).proveedores.find((p: { clave: string }) => p.clave === provId);
    expect(enCatalogo).toMatchObject({ giro: 'DJ', productos: [{ clave: prod.id, nombre: 'DJ 5 horas', comisionPct: 15 }] });
  });

  it('un producto de otro proveedor se rechaza', async () => {
    const a = await nuevoProveedor(`Pista A ${sufijo}`);
    const b = await nuevoProveedor(`Pista B ${sufijo}`);
    const prodB = await nuevoProducto(b, { nombre: 'Pista 6x6', comisionPct: 10 });
    const q = await evento();
    const servicio = { nombre: 'Pista', kind: 'fijo' as const, monto: 10_000, cantidad: 1, proveedorId: a, productoProveedorId: prodB.id };
    await expect(updateQuote(prisma, q.id, { ...(await guardada(q.id)), extras: [servicio] }, admin)).rejects.toMatchObject({ status: 400 });
  });

  it('cambiar solo la comisión deja rastro para el BI; renombrar al proveedor no cuenta como cambio', async () => {
    const provId = await nuevoProveedor(`Grupo prueba ${sufijo}`, { giro: 'Música en vivo' });
    const q = await evento();
    const servicio = { nombre: 'Grupo musical', kind: 'fijo' as const, monto: 15_000, cantidad: 1, proveedorId: provId };
    await updateQuote(prisma, q.id, { ...(await guardada(q.id)), extras: [servicio] }, admin);
    const ultimaEdicion = async () =>
      (await prisma.activityLog.findFirst({ where: { quoteId: q.id, tipo: 'edicion' }, orderBy: { createdAt: 'desc' } }))?.id;

    const antesComision = await ultimaEdicion();
    await updateQuote(prisma, q.id, { ...(await guardada(q.id)), extras: [{ ...servicio, comisionPct: 10 }] }, admin);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { quoteId: q.id, tipo: 'edicion' }, orderBy: { createdAt: 'desc' } });
    expect(log.id).not.toBe(antesComision);
    expect(JSON.stringify(log.meta)).toContain('"comisionPct":10');

    expect((await pedir('PATCH', `/api/admin/proveedores/${provId}`, cookieAdmin, { nombre: `Grupo prueba ${sufijo} SA` })).statusCode).toBe(200);
    const antesRenombre = await ultimaEdicion();
    const totalAntes = (await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).total;
    await updateQuote(prisma, q.id, await guardada(q.id), admin);
    expect(await ultimaEdicion()).toBe(antesRenombre);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).total).toBe(totalAntes);
    expect((await guardada(q.id)).extras[0]!.proveedor).toBe(`Grupo prueba ${sufijo} SA`);
  });

  it('un cargo no acepta una comisión mayor que el cargo', async () => {
    const q = await evento();
    const r = await pedir('POST', `/api/quotes/${q.id}/cargos`, cookieAdmin, {
      producto: 'otro', cantidad: 1, precioUnitario: 2_000, descripcion: 'Pista', fecha: '2067-03-01', proveedor: 'Alguien', comisionMonto: 3_000,
    });
    expect(r.statusCode).toBe(400);
  });

  it('un cargo del punto de venta con producto: /cargos trae su proveedor y producto', async () => {
    const provId = await nuevoProveedor(`Iluminación prueba ${sufijo}`, { giro: 'Iluminación' });
    const prod = await nuevoProducto(provId, { nombre: 'Luz arquitectónica', comisionMonto: 1_000 });
    const q = await evento();
    const r = await pedir('POST', `/api/quotes/${q.id}/cargos`, cookieAdmin, {
      producto: 'otro', cantidad: 1, precioUnitario: 11_600, descripcion: 'Luz arquitectónica', fecha: '2067-03-01',
      productoProveedorId: prod.id, comisionMonto: 1_000,
    });
    expect(r.statusCode).toBe(201);
    const cargo = (await bi('cargos', q.id)).json().datos[0];
    expect(cargo).toMatchObject({ proveedor: `Iluminación prueba ${sufijo}`, proveedorId: provId, productoProveedorId: prod.id });
    expect(cargo.comision).toMatchObject({ monto: 1_000 });
  });
});
