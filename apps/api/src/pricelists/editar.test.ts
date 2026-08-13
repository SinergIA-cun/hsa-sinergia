import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createQuote, type Actor } from '../quotes/service.js';
import { loadCatalog } from '../catalog/loader.js';
import { activarCatalogo, clonarCatalogo } from './service.js';
import { borrarServicio, crearServicio, editarRentas, editarServicio } from './editar.js';
import { borrarCatalogoDePrueba } from './testSupport.js';

let app: FastifyInstance;
let actor: Actor;
let ventasId: string;
/** El catálogo que estaba activo antes de estos tests. Se restaura POR ID. */
let activoOriginalId: string;

const ventasEmail = `ventas-editar-${randomUUID()}@haciendasanandres.com.mx`;
/** El `nombre` del catálogo es `@unique`: sufijo por corrida o la siguiente muere. */
const SUF = randomUUID().slice(0, 8);
const creados: string[] = [];
const createdQuoteIds: string[] = [];
const createdClientIds: string[] = [];

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin@haciendasanandres.com.mx' },
  });
  actor = { id: admin.id, role: 'admin' };
  const ventas = await prisma.user.create({
    data: {
      nombre: 'Vendedora de edición',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventasId = ventas.id;
  activoOriginalId = (await prisma.priceList.findFirstOrThrow({ where: { activa: true } })).id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
  await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  for (const id of creados) await borrarCatalogoDePrueba(prisma, id);
  // Se restaura por ID y no por año: dos catálogos pueden compartir año, y dejar
  // activo el equivocado represiaría a las suites que corren después.
  await prisma.$transaction([
    prisma.priceList.updateMany({ data: { activa: false } }),
    prisma.priceList.update({ where: { id: activoOriginalId }, data: { activa: true } }),
  ]);
  await prisma.user.delete({ where: { id: ventasId } });
  await app.close();
});

/** Clona el catálogo activo original y lo apunta para que el `afterAll` lo limpie. */
async function catalogoDePrueba(nombre: string, anio: number) {
  const clon = await clonarCatalogo(prisma, {
    nombre: `${nombre}-${SUF}`,
    anio,
    clonarDe: activoOriginalId,
  });
  creados.push(clon.id);
  return clon;
}

/**
 * Corre `fn` con el catálogo de prueba activo y devuelve el activo original al
 * terminar, pase lo que pase. `createQuote` casa la cotización al catálogo
 * ACTIVO, y es la única forma de tener una cotización real sobre un catálogo de
 * prueba sin tocar el de producción.
 */
async function conCatalogoActivo<T>(priceListId: string, fn: () => Promise<T>): Promise<T> {
  await activarCatalogo(prisma, priceListId);
  try {
    return await fn();
  } finally {
    await activarCatalogo(prisma, activoOriginalId);
  }
}

async function cotizacionEn(priceListId: string, fecha: string) {
  return conCatalogoActivo(priceListId, async () => {
    const eventType = await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } });
    const arcos = await prisma.space.findFirstOrThrow({ where: { nombre: 'Salón Los Arcos' } });
    const q = await createQuote(
      prisma,
      {
        fecha,
        invitados: 250,
        spaceIds: [arcos.id],
        eventTypeId: eventType.id,
        client: { nombre: `Cliente editar ${randomUUID().slice(0, 6)}` },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    return q;
  });
}

async function ventasCookies() {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: ventasEmail, password: 'ventas1234' },
  });
  const cookie = login.cookies[0]!;
  return { [cookie.name]: cookie.value };
}

async function adminCookies() {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
  });
  const cookie = login.cookies[0]!;
  return { [cookie.name]: cookie.value };
}

/** Un renglón de renta del catálogo, el de menor `min` de un espacio con precio. */
function primerRenglon(priceListId: string) {
  return prisma.rentalPrice.findFirstOrThrow({
    where: { priceListId, tipo: 'dia' },
    orderBy: [{ spaceId: 'asc' }, { min: 'asc' }],
  });
}

describe('editar precios de renta', () => {
  it('actualiza los cuatro precios de un renglón y no toca los demás', async () => {
    const cat = await catalogoDePrueba('EDIT-RENTA', 2078);
    const r = await primerRenglon(cat.id);
    const vecino = await prisma.rentalPrice.findFirstOrThrow({
      where: { priceListId: cat.id, id: { not: r.id } },
      orderBy: { id: 'asc' },
    });

    await editarRentas(
      prisma,
      cat.id,
      { cambios: [{ id: r.id, viernes: 111, viernesEspecial: 222, sabado: 333, domAJue: 444 }] },
      actor,
    );

    const despues = await prisma.rentalPrice.findUniqueOrThrow({ where: { id: r.id } });
    expect(despues.viernes).toBe(111);
    expect(despues.viernesEspecial).toBe(222);
    expect(despues.sabado).toBe(333);
    expect(despues.domAJue).toBe(444);
    // El rango de invitados no se toca: agregar o quitar rangos deja huecos y el
    // motor lanza "no tiene rango de renta para N invitados".
    expect(despues.min).toBe(r.min);
    expect(despues.max).toBe(r.max);

    const vecinoDespues = await prisma.rentalPrice.findUniqueOrThrow({ where: { id: vecino.id } });
    expect(vecinoDespues.sabado).toBe(vecino.sabado);
    expect(vecinoDespues.viernes).toBe(vecino.viernes);
  });

  it('rechaza precios negativos o no enteros', async () => {
    const cat = await catalogoDePrueba('EDIT-RENTA-MAL', 2077);
    const r = await primerRenglon(cat.id);
    const base = { id: r.id, viernes: 1000, viernesEspecial: 1000, sabado: 1000, domAJue: 1000 };

    await expect(
      editarRentas(prisma, cat.id, { cambios: [{ ...base, sabado: -1 }] }, actor),
    ).rejects.toThrow();
    // Postgres TRUNCA los flotantes en columnas Int sin avisar: 1234.5 → 1234.
    await expect(
      editarRentas(prisma, cat.id, { cambios: [{ ...base, sabado: 1234.5 }] }, actor),
    ).rejects.toThrow();

    const intacto = await prisma.rentalPrice.findUniqueOrThrow({ where: { id: r.id } });
    expect(intacto.sabado).toBe(r.sabado);
  });

  it('rechaza un renglón que no pertenece al catálogo', async () => {
    const cat = await catalogoDePrueba('EDIT-RENTA-AJENA', 2076);
    const ajeno = await primerRenglon(activoOriginalId);

    await expect(
      editarRentas(
        prisma,
        cat.id,
        { cambios: [{ id: ajeno.id, viernes: 1, viernesEspecial: 1, sabado: 1, domAJue: 1 }] },
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 });

    // Y el renglón del catálogo de producción quedó intacto.
    const despues = await prisma.rentalPrice.findUniqueOrThrow({ where: { id: ajeno.id } });
    expect(despues.sabado).toBe(ajeno.sabado);
    expect(despues.viernes).toBe(ajeno.viernes);
  });

  it('NO reescribe el total ni el breakdown de las cotizaciones existentes', async () => {
    // El guardián del invariante del tramo 1: una cotización nunca cambia de
    // precio sola. Editar el catálogo deja congelados `total` y `breakdown`; el
    // represiado solo ocurre si alguien REEDITA la cotización después.
    const cat = await catalogoDePrueba('EDIT-INVARIANTE', 2075);
    const q = await cotizacionEn(cat.id, '2032-03-06');
    const totalAntes = q.total;
    const breakdownAntes = JSON.stringify(q.breakdown);
    expect(totalAntes).toBeGreaterThan(0);

    const rentas = await prisma.rentalPrice.findMany({ where: { priceListId: cat.id, tipo: 'dia' } });
    await editarRentas(
      prisma,
      cat.id,
      {
        cambios: rentas.map((r) => ({
          id: r.id,
          viernes: r.viernes * 2,
          viernesEspecial: r.viernesEspecial * 2,
          sabado: r.sabado * 2,
          domAJue: r.domAJue * 2,
        })),
      },
      actor,
    );

    const guardada = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(guardada.total).toBe(totalAntes);
    expect(JSON.stringify(guardada.breakdown)).toBe(breakdownAntes);
    expect(guardada.rentaTotal).toBe(q.rentaTotal);
    // Y el catálogo sí subió: el test no pasa por no haber cambiado nada.
    const unaRenta = await prisma.rentalPrice.findUniqueOrThrow({ where: { id: rentas[0]!.id } });
    expect(unaRenta.sabado).toBe(rentas[0]!.sabado * 2);
  });

  it('queda en la bitácora con el impacto del momento', async () => {
    const cat = await catalogoDePrueba('EDIT-RENTA-LOG', 2074);
    await cotizacionEn(cat.id, '2032-03-13');
    const r = await primerRenglon(cat.id);

    await editarRentas(
      prisma,
      cat.id,
      { cambios: [{ id: r.id, viernes: 10, viernesEspecial: 20, sabado: 30, domAJue: 40 }] },
      actor,
    );

    const log = await prisma.priceListAudit.findMany({ where: { priceListId: cat.id } });
    expect(log).toHaveLength(1);
    expect(log[0]!.tipo).toBe('renta');
    expect(log[0]!.cotizacionesEnRiesgo).toBeGreaterThan(0);
    expect(log[0]!.actorId).toBe(actor.id);
    // El antes/después es lo que permite reconstruir el cambio meses después.
    expect(log[0]!.meta).toMatchObject({
      renglones: [{ id: r.id, antes: { sabado: r.sabado }, despues: { sabado: 30 } }],
    });
  });

  it('solo admin', async () => {
    const cat = await catalogoDePrueba('EDIT-RENTA-403', 2073);
    const r = await primerRenglon(cat.id);
    const payload = { cambios: [{ id: r.id, viernes: 1, viernesEspecial: 1, sabado: 1, domAJue: 1 }] };

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/price-lists/${cat.id}/rentas`,
      cookies: await ventasCookies(),
      payload,
    });
    expect(res.statusCode).toBe(403);
    expect((await prisma.rentalPrice.findUniqueOrThrow({ where: { id: r.id } })).sabado).toBe(r.sabado);

    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/admin/price-lists/${cat.id}/rentas`,
      cookies: await adminCookies(),
      payload,
    });
    expect(ok.statusCode).toBe(200);
    expect((await prisma.rentalPrice.findUniqueOrThrow({ where: { id: r.id } })).sabado).toBe(1);
  });
});

describe('servicios del catálogo', () => {
  it('agrega un servicio al catálogo, no a los demás', async () => {
    const cat = await catalogoDePrueba('SERV-ALTA', 2072);
    const antesOtro = await prisma.addOn.count({ where: { priceListId: activoOriginalId } });

    const s = await crearServicio(
      prisma,
      cat.id,
      { nombre: 'Pirotecnia fría', kind: 'fijo', price: 12000 },
      actor,
    );
    expect(s.priceListId).toBe(cat.id);
    expect(s.activo).toBe(true);
    expect(await prisma.addOn.count({ where: { priceListId: cat.id, nombre: 'Pirotecnia fría' } })).toBe(1);
    // El catálogo de producción no se enteró.
    expect(await prisma.addOn.count({ where: { priceListId: activoOriginalId } })).toBe(antesOtro);
    expect(
      await prisma.priceListAudit.count({ where: { priceListId: cat.id, tipo: 'servicio' } }),
    ).toBe(1);
  });

  it('edita nombre, precio y tipo de cobro', async () => {
    const cat = await catalogoDePrueba('SERV-EDITA', 2071);
    const s = await crearServicio(prisma, cat.id, { nombre: 'Mesa de dulces', kind: 'fijo', price: 5000 }, actor);

    const editado = await editarServicio(
      prisma,
      cat.id,
      s.id,
      { nombre: 'Mesa de postres', kind: 'porPersona', price: 90 },
      actor,
    );
    expect(editado.nombre).toBe('Mesa de postres');
    expect(editado.kind).toBe('porPersona');
    expect(editado.price).toBe(90);
  });

  it('un servicio de otro catálogo no se puede editar ni borrar desde aquí', async () => {
    const cat = await catalogoDePrueba('SERV-AJENO', 2070);
    const ajeno = await prisma.addOn.findFirstOrThrow({ where: { priceListId: activoOriginalId } });

    await expect(
      editarServicio(prisma, cat.id, ajeno.id, { price: 1 }, actor),
    ).rejects.toMatchObject({ status: 400 });
    await expect(borrarServicio(prisma, cat.id, ajeno.id, actor)).rejects.toMatchObject({ status: 400 });
    expect((await prisma.addOn.findUniqueOrThrow({ where: { id: ajeno.id } })).price).toBe(ajeno.price);
  });

  it('desactivar lo saca del selector pero el catálogo lo sigue resolviendo', async () => {
    // Es la lección del PR #2: `activo: false` NO puede desaparecer del catálogo,
    // o las cotizaciones que lo traen quedan irrecalculables.
    const cat = await catalogoDePrueba('SERV-BAJA', 2069);
    const s = await crearServicio(prisma, cat.id, { nombre: 'Valet de prueba', kind: 'porUnidad', price: 60 }, actor);

    await editarServicio(prisma, cat.id, s.id, { activo: false }, actor);

    const catalogo = await loadCatalog(prisma, { priceListId: cat.id });
    const resuelto = catalogo.addOns.find((a) => a.id === s.id);
    expect(resuelto).toBeDefined();
    expect(resuelto!.activo).toBe(false);
    expect(resuelto!.price).toBe(60);
  });

  it('borrar un servicio EN USO responde 409 y no lo borra', async () => {
    const cat = await catalogoDePrueba('SERV-EN-USO', 2068);
    const s = await crearServicio(prisma, cat.id, { nombre: 'Servicio usado', kind: 'fijo', price: 800 }, actor);
    const q = await cotizacionEn(cat.id, '2032-04-03');
    await prisma.quote.update({
      where: { id: q.id },
      data: { addOns: [{ addOnId: s.id, cantidad: 1 }] },
    });

    await expect(borrarServicio(prisma, cat.id, s.id, actor)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.addOn.findUnique({ where: { id: s.id } })).not.toBeNull();
  });

  it('borrar un servicio sin uso sí lo borra', async () => {
    const cat = await catalogoDePrueba('SERV-BORRABLE', 2067);
    const s = await crearServicio(prisma, cat.id, { nombre: 'Servicio sin uso', kind: 'fijo', price: 300 }, actor);

    await borrarServicio(prisma, cat.id, s.id, actor);
    expect(await prisma.addOn.findUnique({ where: { id: s.id } })).toBeNull();
    // El rastro del borrado queda aunque el servicio ya no exista.
    expect(
      await prisma.priceListAudit.count({ where: { priceListId: cat.id, tipo: 'servicio' } }),
    ).toBe(2); // el alta y la baja
  });

  it('rechaza precio negativo o no entero', async () => {
    const cat = await catalogoDePrueba('SERV-PRECIO', 2066);
    await expect(
      crearServicio(prisma, cat.id, { nombre: 'Negativo', kind: 'fijo', price: -1 }, actor),
    ).rejects.toThrow();
    await expect(
      crearServicio(prisma, cat.id, { nombre: 'Fraccionado', kind: 'fijo', price: 99.5 }, actor),
    ).rejects.toThrow();
    expect(await prisma.addOn.count({ where: { priceListId: cat.id, nombre: 'Negativo' } })).toBe(0);
  });

  it('solo admin', async () => {
    const cat = await catalogoDePrueba('SERV-403', 2065);
    const ventas = await ventasCookies();
    const payload = { nombre: 'Servicio de ventas', kind: 'fijo', price: 100 };

    const post = await app.inject({
      method: 'POST',
      url: `/api/admin/price-lists/${cat.id}/servicios`,
      cookies: ventas,
      payload,
    });
    expect(post.statusCode).toBe(403);
    expect(await prisma.addOn.count({ where: { priceListId: cat.id, nombre: payload.nombre } })).toBe(0);

    const creado = await app.inject({
      method: 'POST',
      url: `/api/admin/price-lists/${cat.id}/servicios`,
      cookies: await adminCookies(),
      payload,
    });
    expect(creado.statusCode).toBe(201);
    const addOnId = creado.json().addOn.id as string;

    for (const [method, url] of [
      ['PATCH', `/api/admin/price-lists/${cat.id}/servicios/${addOnId}`],
      ['DELETE', `/api/admin/price-lists/${cat.id}/servicios/${addOnId}`],
    ] as const) {
      const res = await app.inject({ method, url, cookies: ventas, payload: { price: 1 } });
      expect(res.statusCode).toBe(403);
    }
    expect(await prisma.addOn.findUnique({ where: { id: addOnId } })).not.toBeNull();
  });
});
