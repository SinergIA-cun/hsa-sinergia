import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
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
  // Los contratos de prueba primero: si una prueba truena a medias, la limpieza
  // inline no corre y el contrato se queda para siempre en la base compartida.
  // Ya pasó una vez.
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
  await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
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
      payload: { nombre: 'Banquetero Borrable', telefono: '55 0000 0000' },
    });
    const id = res.json().banquetero.id as string;
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/banqueteros/${id}`, cookies: cookie() });
    expect(del.statusCode).toBe(204);
    expect(await prisma.banquetero.findUnique({ where: { id } })).toBeNull();
  });
});

describe('el contacto del banquetero', () => {
  it('no deja dar de alta uno sin teléfono', async () => {
    // De estos señores depende dinero: un banquetero al que no se le puede
    // hablar es una contraparte que nadie sabe localizar.
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/banqueteros',
      cookies: cookie(),
      payload: { nombre: 'ZZ Sin teléfono' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('guarda el correo y deja corregir el teléfono después', async () => {
    const alta = await app.inject({
      method: 'POST',
      url: '/api/admin/banqueteros',
      cookies: cookie(),
      payload: {
        nombre: `ZZ Con contacto ${randomUUID().slice(0, 6)}`,
        telefono: '55 1111 2222',
        correo: 'contacto@banquetes.mx',
      },
    });
    expect(alta.statusCode).toBe(201);
    const id = alta.json().banquetero.id as string;
    createdBanqueteroIds.push(id);
    expect(alta.json().banquetero.correo).toBe('contacto@banquetes.mx');

    // Editar SÍ admite vaciarlo: es como se corrige uno mal capturado, y los
    // banqueteros que ya existían sin teléfono no se pueden bloquear.
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/banqueteros/${id}`,
      cookies: cookie(),
      payload: { telefono: null, correo: null },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().banquetero.telefono).toBeNull();
  });
});

describe('borrar algo que un contrato usa', () => {
  it('el 409 del banquetero llega con la lista de contratos, no solo con el número', async () => {
    // El reporte del dueño: "me dice que 1 contrato lo usa. Encontrar ese
    // contrato en 300 contratos diferentes se vuelve una pesadilla."
    const banq = await prisma.banquetero.create({
      data: { nombre: `ZZ Banquetero usado ${randomUUID().slice(0, 6)}` },
    });
    createdBanqueteroIds.push(banq.id);

    // El contrato se arma directo y con su catálogo FIJADO, sin pasar por
    // `createQuote`: así esta prueba no depende de cuál catálogo esté activo, que
    // es un estado que otras suites mueven y restauran.
    const eventType = await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } });
    const arcos = await prisma.space.findFirstOrThrow({ where: { nombre: 'Salón Los Arcos' } });
    const cliente = await prisma.client.create({
      data: { nombre: 'Cliente que bloquea el borrado' },
    });
    createdClientIds.push(cliente.id);
    const q = await prisma.quote.create({
      data: {
        clientId: cliente.id,
        eventTypeId: eventType.id,
        priceListId: (await catalogoActivo()).id,
        banqueteroId: banq.id,
        fechaEvento: new Date('2033-09-10T00:00:00.000Z'),
        invitados: 200,
        spaceIds: [arcos.id],
        breakdown: { lines: [], total: 0, rentaTotal: 0 },
        total: 0,
        rentaTotal: 0,
        etiqueta: `10SEP-CBLOQUEA-ARCOS-${randomUUID().slice(0, 4)}`,
        publicToken: randomUUID(),
      },
    });
    createdQuoteIds.push(q.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/banqueteros/${banq.id}`,
      cookies: cookie(),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    // El mensaje sigue estando; lo nuevo es que se puede ir directo.
    expect(body.error).toContain('No se puede borrar');
    expect(body.enUso.total).toBe(1);
    expect(body.enUso.muestra[0].id).toBe(q.id);
    expect(body.enUso.muestra[0].cliente).toBe('Cliente que bloquea el borrado');
    expect(body.enUso.muestra[0].enPapelera).toBe(false);
    expect(body.enUso.muestra[0].etiqueta).toBe(q.etiqueta);

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
