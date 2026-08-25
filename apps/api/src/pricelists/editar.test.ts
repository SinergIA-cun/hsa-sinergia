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
import {
  borrarPaquete,
  borrarServicio,
  crearPaquete,
  crearServicio,
  editarDj,
  editarParametros,
  editarPaquete,
  editarRentas,
  editarServicio,
} from './editar.js';
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
    // Prisma TRUNCA los flotantes en columnas Int sin avisar: 1234.5 → 1234.
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

  it('el 409 dice CUÁLES contratos lo usan, con nombre y código', async () => {
    // "En uso por 1 contrato" sin decir cuál convierte el borrado en una
    // búsqueda a mano entre cientos de contratos. Es el reporte del dueño.
    const cat = await catalogoDePrueba('SERV-QUIEN-USA', 2066);
    const s = await crearServicio(prisma, cat.id, { nombre: 'Servicio rastreable', kind: 'fijo', price: 500 }, actor);
    const q = await cotizacionEn(cat.id, '2032-05-08');
    await prisma.quote.update({
      where: { id: q.id },
      data: { addOns: [{ addOnId: s.id, cantidad: 1 }] },
    });
    const cliente = await prisma.client.findUniqueOrThrow({ where: { id: q.clientId } });

    await expect(borrarServicio(prisma, cat.id, s.id, actor)).rejects.toMatchObject({
      status: 409,
      detalle: {
        enUso: {
          total: 1,
          muestra: [
            {
              id: q.id,
              cliente: cliente.nombre,
              codigo: q.codigo,
              enPapelera: false,
            },
          ],
        },
      },
    });
  });

  it('avisa cuando el contrato que bloquea está en la papelera', async () => {
    // El peor caso: un contrato eliminado no aparece en ninguna lista, así que
    // sin decirlo la búsqueda es infinita y el bloqueo, inexplicable.
    const cat = await catalogoDePrueba('SERV-PAPELERA', 2065);
    const s = await crearServicio(prisma, cat.id, { nombre: 'Servicio en papelera', kind: 'fijo', price: 400 }, actor);
    const q = await cotizacionEn(cat.id, '2032-06-05');
    await prisma.quote.update({
      where: { id: q.id },
      data: { addOns: [{ addOnId: s.id, cantidad: 1 }], deletedAt: new Date() },
    });

    await expect(borrarServicio(prisma, cat.id, s.id, actor)).rejects.toMatchObject({
      status: 409,
      detalle: { enUso: { total: 1, muestra: [{ id: q.id, enPapelera: true }] } },
    });
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

describe('paquetes de alimentos del catálogo', () => {
  const brackets3 = [
    { min: 1, max: 100, pricePerPerson: 400 },
    { min: 101, max: 200, pricePerPerson: 380 },
    { min: 201, max: null, pricePerPerson: 350 },
  ];

  async function bodaId() {
    return (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  }

  it('crea un paquete con sus brackets', async () => {
    const cat = await catalogoDePrueba('PAQ-ALTA', 2064);
    const p = await crearPaquete(
      prisma,
      cat.id,
      { nombre: 'Menú de prueba', eventTypeId: await bodaId(), brackets: brackets3 },
      actor,
    );
    expect(p.priceListId).toBe(cat.id);
    expect(p.brackets).toHaveLength(3);
    expect(p.brackets.map((b) => b.pricePerPerson).sort((a, b) => a - b)).toEqual([350, 380, 400]);
    expect(
      await prisma.priceListAudit.count({ where: { priceListId: cat.id, tipo: 'paquete' } }),
    ).toBe(1);
  });

  it('un paquete sin brackets no se puede crear', async () => {
    // 400: un paquete sin precio hace que el motor lance
    // "no tiene rango para N invitados" al primer uso.
    const cat = await catalogoDePrueba('PAQ-SIN-BRACKETS', 2063);
    await expect(
      crearPaquete(prisma, cat.id, { nombre: 'Vacío', eventTypeId: await bodaId(), brackets: [] }, actor),
    ).rejects.toThrow();
    expect(await prisma.foodPackage.count({ where: { priceListId: cat.id, nombre: 'Vacío' } })).toBe(0);
  });

  it('los brackets no se traslapan ni dejan hueco', async () => {
    const cat = await catalogoDePrueba('PAQ-BRACKETS', 2062);
    const eventTypeId = await bodaId();

    const traslape = [
      { min: 50, max: 100, pricePerPerson: 400 },
      { min: 90, max: 200, pricePerPerson: 380 },
    ];
    const hueco = [
      { min: 50, max: 100, pricePerPerson: 400 },
      { min: 150, max: 200, pricePerPerson: 380 },
    ];
    for (const brackets of [traslape, hueco]) {
      await expect(
        crearPaquete(prisma, cat.id, { nombre: `Malo ${brackets[1]!.min}`, eventTypeId, brackets }, actor),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(await prisma.foodPackage.count({ where: { priceListId: cat.id, nombre: { startsWith: 'Malo' } } })).toBe(0);
  });

  it('edita el precio por persona de un bracket', async () => {
    const cat = await catalogoDePrueba('PAQ-EDITA', 2061);
    const p = await crearPaquete(
      prisma,
      cat.id,
      { nombre: 'Menú editable', eventTypeId: await bodaId(), brackets: brackets3 },
      actor,
    );

    const nuevos = brackets3.map((b) => (b.min === 101 ? { ...b, pricePerPerson: 999 } : b));
    const editado = await editarPaquete(prisma, cat.id, p.id, { brackets: nuevos }, actor);
    const bracket = editado.brackets.find((b) => b.min === 101);
    expect(bracket?.pricePerPerson).toBe(999);
    // Y el juego completo sigue siendo válido: tres rangos, ni uno perdido.
    expect(editado.brackets).toHaveLength(3);

    // Un juego inválido no reemplaza nada.
    await expect(
      editarPaquete(prisma, cat.id, p.id, { brackets: [{ min: 1, max: 50, pricePerPerson: 1 }, { min: 100, max: null, pricePerPerson: 2 }] }, actor),
    ).rejects.toMatchObject({ status: 400 });
    expect(await prisma.foodPackagePrice.count({ where: { packageId: p.id } })).toBe(3);
  });

  it('rechaza un precio por persona negativo o no entero', async () => {
    const cat = await catalogoDePrueba('PAQ-PRECIO', 2060);
    const eventTypeId = await bodaId();
    for (const pricePerPerson of [-1, 400.5]) {
      await expect(
        crearPaquete(
          prisma,
          cat.id,
          { nombre: `Precio ${pricePerPerson}`, eventTypeId, brackets: [{ min: 1, max: null, pricePerPerson }] },
          actor,
        ),
      ).rejects.toThrow();
    }
  });

  it('borrar un paquete EN USO responde 409', async () => {
    const cat = await catalogoDePrueba('PAQ-EN-USO', 2059);
    const p = await crearPaquete(
      prisma,
      cat.id,
      { nombre: 'Menú en uso', eventTypeId: await bodaId(), brackets: brackets3 },
      actor,
    );
    const q = await cotizacionEn(cat.id, '2032-05-08');
    await prisma.quote.update({ where: { id: q.id }, data: { foodPackageId: p.id } });

    await expect(borrarPaquete(prisma, cat.id, p.id, actor)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.foodPackage.findUnique({ where: { id: p.id } })).not.toBeNull();

    // Sin uso sí se borra, con sus brackets.
    await prisma.quote.update({ where: { id: q.id }, data: { foodPackageId: null } });
    await borrarPaquete(prisma, cat.id, p.id, actor);
    expect(await prisma.foodPackage.findUnique({ where: { id: p.id } })).toBeNull();
    expect(await prisma.foodPackagePrice.count({ where: { packageId: p.id } })).toBe(0);
  });

  it('respeta el eventTypeId: un paquete es de un tipo de evento', async () => {
    const cat = await catalogoDePrueba('PAQ-EVENTO', 2058);
    const boda = await bodaId();
    const bautizo = (await prisma.eventType.findFirstOrThrow({ where: { slug: { not: 'boda' } } })).id;

    const p = await crearPaquete(
      prisma,
      cat.id,
      { nombre: 'Menú de un tipo', eventTypeId: boda, brackets: brackets3 },
      actor,
    );
    expect(p.eventTypeId).toBe(boda);

    const catalogo = await loadCatalog(prisma, { priceListId: cat.id });
    const resuelto = catalogo.foodPackages.find((f) => f.id === p.id);
    expect(resuelto?.eventTypeId).toBe(boda);
    expect(resuelto?.eventTypeId).not.toBe(bautizo);

    // Y se puede mover a otro tipo de evento; un tipo inexistente es 400.
    const movido = await editarPaquete(prisma, cat.id, p.id, { eventTypeId: bautizo }, actor);
    expect(movido.eventTypeId).toBe(bautizo);
    await expect(
      editarPaquete(prisma, cat.id, p.id, { eventTypeId: 'no-existe' }, actor),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('un paquete de otro catálogo no se toca desde aquí', async () => {
    const cat = await catalogoDePrueba('PAQ-AJENO', 2057);
    const ajeno = await prisma.foodPackage.findFirstOrThrow({ where: { priceListId: activoOriginalId } });
    await expect(
      editarPaquete(prisma, cat.id, ajeno.id, { nombre: 'Pirata' }, actor),
    ).rejects.toMatchObject({ status: 400 });
    await expect(borrarPaquete(prisma, cat.id, ajeno.id, actor)).rejects.toMatchObject({ status: 400 });
    expect((await prisma.foodPackage.findUniqueOrThrow({ where: { id: ajeno.id } })).nombre).toBe(ajeno.nombre);
  });

  it('solo admin', async () => {
    const cat = await catalogoDePrueba('PAQ-403', 2056);
    const ventas = await ventasCookies();
    const payload = { nombre: 'Menú de ventas', eventTypeId: await bodaId(), brackets: brackets3 };

    const post = await app.inject({
      method: 'POST',
      url: `/api/admin/price-lists/${cat.id}/paquetes`,
      cookies: ventas,
      payload,
    });
    expect(post.statusCode).toBe(403);
    expect(await prisma.foodPackage.count({ where: { priceListId: cat.id, nombre: payload.nombre } })).toBe(0);

    const creado = await app.inject({
      method: 'POST',
      url: `/api/admin/price-lists/${cat.id}/paquetes`,
      cookies: await adminCookies(),
      payload,
    });
    expect(creado.statusCode).toBe(201);
    const packageId = creado.json().paquete.id as string;

    for (const [method, url] of [
      ['PATCH', `/api/admin/price-lists/${cat.id}/paquetes/${packageId}`],
      ['DELETE', `/api/admin/price-lists/${cat.id}/paquetes/${packageId}`],
    ] as const) {
      const res = await app.inject({ method, url, cookies: ventas, payload: { nombre: 'x' } });
      expect(res.statusCode).toBe(403);
    }
    expect(await prisma.foodPackage.findUnique({ where: { id: packageId } })).not.toBeNull();
  });
});

describe('DJ y parámetros del catálogo', () => {
  async function bodaId() {
    return (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  }

  it('edita el precio del DJ de un tipo de evento', async () => {
    const cat = await catalogoDePrueba('DJ-EDITA', 2055);
    const boda = await bodaId();

    await editarDj(prisma, cat.id, { precios: [{ eventTypeId: boda, price: 4321 }] }, actor);

    const fila = await prisma.djHoraExtraPrice.findUniqueOrThrow({
      where: { priceListId_eventTypeId: { priceListId: cat.id, eventTypeId: boda } },
    });
    expect(fila.price).toBe(4321);
    // Y el catálogo de producción no se movió: 2,950 sigue siendo 2,950.
    const original = await prisma.djHoraExtraPrice.findUniqueOrThrow({
      where: { priceListId_eventTypeId: { priceListId: activoOriginalId, eventTypeId: boda } },
    });
    expect(original.price).toBe(2950);
    expect(await prisma.priceListAudit.count({ where: { priceListId: cat.id, tipo: 'dj' } })).toBe(1);
  });

  it('da de alta el renglón de un tipo de evento que no lo ofrecía', async () => {
    const cat = await catalogoDePrueba('DJ-ALTA', 2054);
    const grad = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'graduacion' } })).id;
    expect(
      await prisma.djHoraExtraPrice.count({ where: { priceListId: cat.id, eventTypeId: grad } }),
    ).toBe(0);

    await editarDj(prisma, cat.id, { precios: [{ eventTypeId: grad, price: 1500 }] }, actor);
    expect(
      (await prisma.djHoraExtraPrice.findUniqueOrThrow({
        where: { priceListId_eventTypeId: { priceListId: cat.id, eventTypeId: grad } },
      })).price,
    ).toBe(1500);
  });

  it('quitar el renglón del DJ deja de cobrarlo en ese tipo de evento', async () => {
    // Es cómo se apaga el servicio: sin renglón, no se ofrece.
    const cat = await catalogoDePrueba('DJ-QUITA', 2053);
    const boda = await bodaId();
    const arcos = await prisma.space.findFirstOrThrow({ where: { nombre: 'Salón Los Arcos' } });

    const cotizarConDj = (fecha: string) =>
      conCatalogoActivo(cat.id, async () => {
        const q = await createQuote(
          prisma,
          {
            fecha,
            invitados: 250,
            spaceIds: [arcos.id],
            eventTypeId: boda,
            horasExtra: 2,
            usaDjHoraExtra: true,
            client: { nombre: `Cliente DJ ${randomUUID().slice(0, 6)}` },
          },
          actor,
        );
        createdQuoteIds.push(q.id);
        createdClientIds.push(q.clientId);
        return q;
      });

    const conRenglon = await cotizarConDj('2032-06-05');
    expect(JSON.stringify(conRenglon.breakdown)).toContain('DJ Hora extra');

    await editarDj(prisma, cat.id, { precios: [{ eventTypeId: boda, price: null }] }, actor);
    expect(
      await prisma.djHoraExtraPrice.count({ where: { priceListId: cat.id, eventTypeId: boda } }),
    ).toBe(0);
    const catalogo = await loadCatalog(prisma, { priceListId: cat.id });
    expect(catalogo.djHoraExtraByEventType[boda]).toBeUndefined();

    const sinRenglon = await cotizarConDj('2032-06-12');
    expect(JSON.stringify(sinRenglon.breakdown)).not.toContain('DJ Hora extra');
    expect(sinRenglon.total).toBeLessThan(conRenglon.total);
  });

  it('rechaza un precio de DJ negativo o no entero, y un tipo de evento inexistente', async () => {
    const cat = await catalogoDePrueba('DJ-MAL', 2052);
    const boda = await bodaId();
    await expect(
      editarDj(prisma, cat.id, { precios: [{ eventTypeId: boda, price: -1 }] }, actor),
    ).rejects.toThrow();
    await expect(
      editarDj(prisma, cat.id, { precios: [{ eventTypeId: boda, price: 2950.5 }] }, actor),
    ).rejects.toThrow();
    await expect(
      editarDj(prisma, cat.id, { precios: [{ eventTypeId: 'no-existe', price: 100 }] }, actor),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('edita IVA, hora extra, descuento de alimentos y capilla en sábado', async () => {
    const cat = await catalogoDePrueba('PARAM-EDITA', 2051);
    const actualizado = await editarParametros(
      prisma,
      cat.id,
      { ivaRate: 0.08, extraHourRate: 0.07, foodDiscountRate: 0.03, capillaSabado: 7500 },
      actor,
    );
    expect(actualizado.ivaRate).toBeCloseTo(0.08);
    expect(actualizado.extraHourRate).toBeCloseTo(0.07);
    expect(actualizado.foodDiscountRate).toBeCloseTo(0.03);
    expect(actualizado.capillaSabado).toBe(7500);
    expect(
      await prisma.priceListAudit.count({ where: { priceListId: cat.id, tipo: 'parametros' } }),
    ).toBe(1);
  });

  it('rechaza tasas fuera de 0..1', async () => {
    // Un IVA de 16 en vez de 0.16 multiplica todo por 100.
    const cat = await catalogoDePrueba('PARAM-TASAS', 2050);
    const antes = await prisma.priceList.findUniqueOrThrow({ where: { id: cat.id } });
    for (const data of [{ ivaRate: 16 }, { ivaRate: -0.1 }, { extraHourRate: 1.5 }, { foodDiscountRate: 2 }]) {
      await expect(editarParametros(prisma, cat.id, data, actor)).rejects.toThrow();
    }
    // La capilla es un PRECIO en pesos, no una tasa: entero y no negativo.
    await expect(editarParametros(prisma, cat.id, { capillaSabado: -1 }, actor)).rejects.toThrow();
    await expect(editarParametros(prisma, cat.id, { capillaSabado: 5000.5 }, actor)).rejects.toThrow();

    const despues = await prisma.priceList.findUniqueOrThrow({ where: { id: cat.id } });
    expect(despues.ivaRate).toBe(antes.ivaRate);
    expect(despues.capillaSabado).toBe(antes.capillaSabado);
  });

  it('los parámetros son del catálogo, no globales', async () => {
    const a = await catalogoDePrueba('PARAM-A', 2049);
    const b = await catalogoDePrueba('PARAM-B', 2048);
    const bAntes = await prisma.priceList.findUniqueOrThrow({ where: { id: b.id } });

    await editarParametros(prisma, a.id, { ivaRate: 0.11, capillaSabado: 1111 }, actor);

    const bDespues = await prisma.priceList.findUniqueOrThrow({ where: { id: b.id } });
    expect(bDespues.ivaRate).toBe(bAntes.ivaRate);
    expect(bDespues.capillaSabado).toBe(bAntes.capillaSabado);
    // Ni el activo de producción.
    const activo = await prisma.priceList.findUniqueOrThrow({ where: { id: activoOriginalId } });
    expect(activo.ivaRate).toBeCloseTo(0.16);
  });

  it('un catálogo inexistente da 404 en DJ y en parámetros', async () => {
    await expect(
      editarDj(prisma, 'no-existe', { precios: [{ eventTypeId: await bodaId(), price: 1 }] }, actor),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      editarParametros(prisma, 'no-existe', { ivaRate: 0.16 }, actor),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('solo admin', async () => {
    const cat = await catalogoDePrueba('DJ-PARAM-403', 2047);
    const boda = await bodaId();
    const ventas = await ventasCookies();

    const dj = await app.inject({
      method: 'PATCH',
      url: `/api/admin/price-lists/${cat.id}/dj`,
      cookies: ventas,
      payload: { precios: [{ eventTypeId: boda, price: 1 }] },
    });
    expect(dj.statusCode).toBe(403);

    const param = await app.inject({
      method: 'PATCH',
      url: `/api/admin/price-lists/${cat.id}/parametros`,
      cookies: ventas,
      payload: { ivaRate: 0.5 },
    });
    expect(param.statusCode).toBe(403);
    expect((await prisma.priceList.findUniqueOrThrow({ where: { id: cat.id } })).ivaRate).toBeCloseTo(0.16);

    const admin = await adminCookies();
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/admin/price-lists/${cat.id}/parametros`,
          cookies: admin,
          payload: { ivaRate: 0.5 },
        })
      ).statusCode,
    ).toBe(200);
    expect((await prisma.priceList.findUniqueOrThrow({ where: { id: cat.id } })).ivaRate).toBeCloseTo(0.5);
  });
});

// El plan describe el aviso de impacto y la bitácora visible (Task 6) pero no
// dice de dónde saca los datos la interfaz. Estos dos endpoints son ese origen.
describe('impacto y bitácora por HTTP', () => {
  it('el admin lee el impacto y la bitácora; ventas no', async () => {
    const cat = await catalogoDePrueba('HTTP-IMPACTO', 2045);
    await cotizacionEn(cat.id, '2032-07-03');
    const r = await primerRenglon(cat.id);
    await editarRentas(
      prisma,
      cat.id,
      { cambios: [{ id: r.id, viernes: 7, viernesEspecial: 7, sabado: 7, domAJue: 7 }] },
      actor,
    );

    const admin = await adminCookies();
    const imp = await app.inject({ method: 'GET', url: `/api/admin/price-lists/${cat.id}/impacto`, cookies: admin });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().impacto.total).toBe(1);
    expect(imp.json().impacto.nombre).toContain('HTTP-IMPACTO');

    const bit = await app.inject({ method: 'GET', url: `/api/admin/price-lists/${cat.id}/bitacora`, cookies: admin });
    expect(bit.statusCode).toBe(200);
    expect(bit.json().bitacora[0].tipo).toBe('renta');
    // Con el nombre de quien lo hizo: un cuid no le dice nada a nadie.
    expect(bit.json().bitacora[0].actor.nombre).toBeTruthy();
    expect(bit.json().bitacora[0].cotizacionesEnRiesgo).toBe(1);

    const ventas = await ventasCookies();
    for (const sufijo of ['impacto', 'bitacora']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/price-lists/${cat.id}/${sufijo}`,
        cookies: ventas,
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('un catálogo inexistente da 404 en los dos', async () => {
    const admin = await adminCookies();
    for (const sufijo of ['impacto', 'bitacora']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/price-lists/no-existe/${sufijo}`,
        cookies: admin,
      });
      expect(res.statusCode).toBe(404);
    }
  });
});
