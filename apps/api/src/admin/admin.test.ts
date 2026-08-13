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
const createdQuoteIds: string[] = [];
const createdClientIds: string[] = [];

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
  await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  await prisma.addOn.deleteMany({ where: { id: { in: createdAddOnIds } } });
  await prisma.cuadrilla.deleteMany({ where: { id: { in: createdCuadrillaIds } } });
  await prisma.empleado.deleteMany({ where: { id: { in: createdEmpleadoIds } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: createdBanqueteroIds } } });
  await app.close();
});

describe('admin add-ons', () => {
  it('POST /admin/addons crea; PATCH /admin/addons/:id actualiza', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/addons',
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { nombre: 'Test Extra', kind: 'fijo', price: 500 },
    });
    expect(createRes.statusCode).toBe(201);
    const addOn = createRes.json().addOn;
    createdAddOnIds.push(addOn.id);
    expect(addOn.nombre).toBe('Test Extra');
    expect(addOn.price).toBe(500);
    expect(addOn.activo).toBe(true);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/addons/${addOn.id}`,
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { price: 600, activo: false },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json().addOn;
    expect(updated.price).toBe(600);
    expect(updated.activo).toBe(false);
  });
});

describe('admin borrado con guardas', () => {
  async function crearAddon(nombre: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/addons',
      cookies: cookie(),
      payload: { nombre, kind: 'fijo', price: 100 },
    });
    const id = res.json().addOn.id as string;
    createdAddOnIds.push(id);
    return id;
  }

  it('DELETE /admin/addons/:id borra un extra no usado (204)', async () => {
    const id = await crearAddon('Extra borrable');
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/addons/${id}`, cookies: cookie() });
    expect(res.statusCode).toBe(204);
    expect(await prisma.addOn.findUnique({ where: { id } })).toBeNull();
  });

  it('DELETE /admin/addons/:id bloquea (409) si un contrato lo referencia', async () => {
    const addOnId = await crearAddon('Extra en uso');
    const client = await prisma.client.create({ data: { nombre: 'Cliente Ref Extra' } });
    createdClientIds.push(client.id);
    const eventType = await prisma.eventType.findFirstOrThrow();
    const quote = await prisma.quote.create({
      data: {
        clientId: client.id,
        eventTypeId: eventType.id,
        fechaEvento: new Date('2027-09-01'),
        invitados: 100,
        spaceIds: [],
        addOns: [{ addOnId, cantidad: 1 }],
        breakdown: {},
        total: 0,
        rentaTotal: 0,
        publicToken: `tok-${Date.now()}`,
        priceListId: (await catalogoActivo()).id,
      },
    });
    createdQuoteIds.push(quote.id);

    const res = await app.inject({ method: 'DELETE', url: `/api/admin/addons/${addOnId}`, cookies: cookie() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/en uso/i);
    // Sigue existiendo (no se borró).
    expect(await prisma.addOn.findUnique({ where: { id: addOnId } })).not.toBeNull();
  });

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
});
