import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let adminCookie: { name: string; value: string };
const createdAddOnIds: string[] = [];
const createdEmpleadoIds: string[] = [];
const createdCuadrillaIds: string[] = [];
const createdBanqueteroIds: string[] = [];

function cookie() {
  return { [adminCookie.name]: adminCookie.value };
}

/** El catálogo activo: servicios y cotizaciones cuelgan de un catálogo. */
function catalogoActivo() {
  return prisma.priceList.findFirstOrThrow({ where: { activa: true }, orderBy: { anio: 'desc' } });
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
  });
  const cookie = login.cookies[0]!;
  adminCookie = { name: cookie.name, value: cookie.value };
});

afterAll(async () => {
  await prisma.addOn.deleteMany({ where: { id: { in: createdAddOnIds } } });
  await prisma.cuadrilla.deleteMany({ where: { id: { in: createdCuadrillaIds } } });
  await prisma.empleado.deleteMany({ where: { id: { in: createdEmpleadoIds } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: createdBanqueteroIds } } });
  await app.close();
});

describe('admin borrado con guardas', () => {
  it('DELETE /admin/empleados/:id borra el empleado y sus membresías (204)', async () => {
    const empRes = await app.inject({
      method: 'POST',
      url: '/api/admin/empleados',
      cookies: cookie(),
      payload: { nombre: 'Empleado Borrable' },
    });
    const empId = empRes.json().empleado.id as string;
    const cuadRes = await app.inject({
      method: 'POST',
      url: '/api/admin/cuadrillas',
      cookies: cookie(),
      payload: { nombre: 'Cuadrilla Test Borrado', empleadoIds: [empId] },
    });
    const cuadId = cuadRes.json().cuadrilla.id as string;
    createdCuadrillaIds.push(cuadId);

    const del = await app.inject({ method: 'DELETE', url: `/api/admin/empleados/${empId}`, cookies: cookie() });
    expect(del.statusCode).toBe(204);
    expect(await prisma.empleado.findUnique({ where: { id: empId } })).toBeNull();
    // La membresía cayó por cascade.
    expect(await prisma.cuadrillaMiembro.count({ where: { empleadoId: empId } })).toBe(0);
  });

  it('DELETE /admin/banqueteros/:id borra uno no asignado (204)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/banqueteros',
      cookies: cookie(),
      payload: { nombre: 'Banquetero Borrable' },
    });
    const id = res.json().banquetero.id as string;
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/banqueteros/${id}`, cookies: cookie() });
    expect(del.statusCode).toBe(204);
    expect(await prisma.banquetero.findUnique({ where: { id } })).toBeNull();
  });
});

describe('borrado de usuarios', () => {
  it('DELETE /users/:id no permite borrar la propia cuenta (409)', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@haciendasanandres.com.mx' },
    });
    const res = await app.inject({ method: 'DELETE', url: `/api/users/${admin.id}`, cookies: cookie() });
    expect(res.statusCode).toBe(409);
  });
});

describe('catálogo del cotizador', () => {
  it('GET /catalog ya no expone config del valet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/catalog',
      cookies: { [adminCookie.name]: adminCookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('config');
  });

  // El selector del formulario solo OFRECE los activos, pero necesita poder
  // NOMBRAR uno inactivo que la cotización ya traiga seleccionado; si el
  // endpoint lo esconde, no hay forma de quitarlo desde la interfaz.
  it('GET /catalog expone los add-ons inactivos marcados con activo=false', async () => {
    const inactivo = await prisma.addOn.create({
      data: {
        nombre: 'ZZZ Add-on dado de baja',
        kind: 'porUnidad',
        price: 100,
        activo: false,
        priceListId: (await catalogoActivo()).id,
      },
    });
    createdAddOnIds.push(inactivo.id);

    const res = await app.inject({ method: 'GET', url: '/api/catalog', cookies: cookie() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      addOns: { id: string; activo: boolean }[];
      engine: { addOns: { id: string; activo: boolean }[] };
    };
    expect(body.addOns.find((a) => a.id === inactivo.id)?.activo).toBe(false);
    // Y el catálogo del motor (el que calcula en el navegador) también lo resuelve.
    expect(body.engine.addOns.find((a) => a.id === inactivo.id)?.activo).toBe(false);
    expect(body.addOns.some((a) => a.activo)).toBe(true);
  });

  // `/admin/config` editaba los parámetros DEL CATÁLOGO ACTIVO: un segundo camino
  // al mismo dato, y la clase de duplicidad que el Plan E vino a eliminar. Se
  // retiró; los parámetros se editan por catálogo en
  // `PATCH /admin/price-lists/:id/parametros`. Este test es el candado de que no
  // vuelva a aparecer.
  it('/admin/config ya no existe (los parámetros son del catálogo)', async () => {
    for (const method of ['GET', 'PATCH'] as const) {
      const res = await app.inject({ method, url: '/api/admin/config', cookies: cookie() });
      expect(res.statusCode).toBe(404);
    }
  });

  // `/admin/addons` administraba los servicios del catálogo ACTIVO: la misma
  // duplicidad que `/admin/config`, y con dos agujeros propios: no escribía en
  // `PriceListAudit` (un cambio de precio desde ahí no dejaba rastro en la
  // bitácora del catálogo) y su PATCH/DELETE no comprobaban a qué catálogo
  // pertenecía el id, así que desde la pantalla del activo se podía tocar un
  // servicio de otro año. Los servicios se editan por catálogo, y punto.
  it('/admin/addons ya no existe (los servicios son del catálogo)', async () => {
    const activa = await catalogoActivo();
    const alguno = await prisma.addOn.findFirstOrThrow({ where: { priceListId: activa.id } });
    const rutas = [
      { method: 'GET', url: '/api/admin/addons' },
      { method: 'POST', url: '/api/admin/addons' },
      { method: 'PATCH', url: `/api/admin/addons/${alguno.id}` },
      { method: 'DELETE', url: `/api/admin/addons/${alguno.id}` },
    ] as const;
    for (const { method, url } of rutas) {
      const res = await app.inject({ method, url, cookies: cookie(), payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    // Y el servicio sigue ahí: ninguna de esas llamadas lo tocó.
    expect(await prisma.addOn.findUnique({ where: { id: alguno.id } })).not.toBeNull();
  });
});
