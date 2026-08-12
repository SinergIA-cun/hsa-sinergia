import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { clonarCatalogo, activarCatalogo, listarCatalogos } from './service.js';

let app: FastifyInstance;
let ventasId: string;
/** El catálogo que estaba activo antes de estos tests. Se restaura POR ID. */
let activoOriginalId: string;

const ventasEmail = `ventas-catalogos-${randomUUID()}@haciendasanandres.com.mx`;
/** El nombre del catálogo es único: un sufijo por corrida evita que un test roto envenene el siguiente. */
const SUF = randomUUID().slice(0, 8);
const creados: string[] = [];

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const ventas = await prisma.user.create({
    data: {
      nombre: 'Vendedora de catálogos',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventasId = ventas.id;
  activoOriginalId = (await prisma.priceList.findFirstOrThrow({ where: { activa: true } })).id;
});

afterAll(async () => {
  // De adentro hacia afuera: los FK a PriceList son RESTRICT.
  await prisma.foodPackagePrice.deleteMany({ where: { package: { priceListId: { in: creados } } } });
  await prisma.foodPackage.deleteMany({ where: { priceListId: { in: creados } } });
  await prisma.addOn.deleteMany({ where: { priceListId: { in: creados } } });
  await prisma.rentalPrice.deleteMany({ where: { priceListId: { in: creados } } });
  await prisma.priceList.deleteMany({ where: { id: { in: creados } } });
  // Se restaura por ID y no por año: dos catálogos pueden compartir año, y dejar
  // activo el equivocado represiaría a las suites que corren después.
  await prisma.$transaction([
    prisma.priceList.updateMany({ data: { activa: false } }),
    prisma.priceList.update({ where: { id: activoOriginalId }, data: { activa: true } }),
  ]);
  await prisma.user.delete({ where: { id: ventasId } });
  await app.close();
});

function activo() {
  return prisma.priceList.findFirstOrThrow({ where: { activa: true } });
}

/** Clona el catálogo activo y apunta el clon para que el `afterAll` lo limpie. */
async function clonDelActivo(nombre: string, anio: number, incrementoPct?: number) {
  const base = await activo();
  const clon = await clonarCatalogo(prisma, {
    nombre: `${nombre}-${SUF}`,
    anio,
    clonarDe: base.id,
    ...(incrementoPct === undefined ? {} : { incrementoPct }),
  });
  creados.push(clon.id);
  return { base, clon };
}

async function ventasCookie() {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: ventasEmail, password: 'ventas1234' },
  });
  const cookie = login.cookies[0]!;
  return { [cookie.name]: cookie.value };
}

describe('catálogos', () => {
  it('clonar copia renta, servicios, paquetes y parámetros', async () => {
    const { base, clon } = await clonDelActivo('CLON', 2098);

    const [rBase, rClon] = await Promise.all([
      prisma.rentalPrice.count({ where: { priceListId: base.id } }),
      prisma.rentalPrice.count({ where: { priceListId: clon.id } }),
    ]);
    expect(rClon).toBe(rBase);
    expect(rClon).toBeGreaterThan(0);

    expect(await prisma.addOn.count({ where: { priceListId: clon.id } })).toBe(
      await prisma.addOn.count({ where: { priceListId: base.id } }),
    );
    expect(await prisma.foodPackage.count({ where: { priceListId: clon.id } })).toBe(
      await prisma.foodPackage.count({ where: { priceListId: base.id } }),
    );

    expect(clon.ivaRate).toBe(base.ivaRate);
    expect(clon.extraHourRate).toBe(base.extraHourRate);
    expect(clon.foodDiscountRate).toBe(base.foodDiscountRate);
    expect(clon.capillaSabado).toBe(base.capillaSabado);
    expect(clon.activa).toBe(false); // clonar NO activa
  });

  it('el clon conserva el tipo de cada renglón de renta (día y plana)', async () => {
    // La renta plana (Team Building) vive en el mismo catálogo, distinguida por
    // `tipo`. Un clon que la aplane a "dia" deja al Team Building sin precio.
    const { base, clon } = await clonDelActivo('CLON-TIPOS', 2093);
    const cuenta = async (priceListId: string, tipo: string) =>
      prisma.rentalPrice.count({ where: { priceListId, tipo } });
    for (const tipo of ['dia', 'plano']) {
      expect(await cuenta(clon.id, tipo)).toBe(await cuenta(base.id, tipo));
    }
    expect(await cuenta(clon.id, 'plano')).toBeGreaterThan(0);
  });

  it('el incremento se aplica a renta, servicios y alimentos', async () => {
    const { base, clon } = await clonDelActivo('CLON-10PCT', 2097, 10);

    const rb = await prisma.rentalPrice.findFirstOrThrow({
      where: { priceListId: base.id },
      orderBy: { id: 'asc' },
    });
    const rc = await prisma.rentalPrice.findFirstOrThrow({
      where: { priceListId: clon.id, spaceId: rb.spaceId, min: rb.min, tipo: rb.tipo },
    });
    expect(rc.sabado).toBe(Math.round(rb.sabado * 1.1));
    expect(rc.viernes).toBe(Math.round(rb.viernes * 1.1));
    expect(rc.viernesEspecial).toBe(Math.round(rb.viernesEspecial * 1.1));
    expect(rc.domAJue).toBe(Math.round(rb.domAJue * 1.1));

    const ab = await prisma.addOn.findFirstOrThrow({ where: { priceListId: base.id }, orderBy: { nombre: 'asc' } });
    const ac = await prisma.addOn.findFirstOrThrow({ where: { priceListId: clon.id, nombre: ab.nombre } });
    expect(ac.price).toBe(Math.round(ab.price * 1.1));
    expect(ac.activo).toBe(ab.activo); // el servicio dado de baja sigue de baja

    const pb = await prisma.foodPackage.findFirstOrThrow({
      where: { priceListId: base.id },
      orderBy: { nombre: 'asc' },
      include: { brackets: { orderBy: { min: 'asc' } } },
    });
    const pc = await prisma.foodPackage.findFirstOrThrow({
      where: { priceListId: clon.id, nombre: pb.nombre },
      include: { brackets: { orderBy: { min: 'asc' } } },
    });
    expect(pc.brackets.map((b) => b.pricePerPerson)).toEqual(
      pb.brackets.map((b) => Math.round(b.pricePerPerson * 1.1)),
    );
  });

  it('el incremento nunca mete flotantes a la base', async () => {
    // Los precios son enteros de pesos. Un flotante que llegue a Postgres se
    // redondea a la mitad PAR (2.5 → 2), que no es lo que hace `Math.round`, así
    // que el catálogo nuevo quedaría un peso abajo en cada renglón impar.
    const PCT = 7.3;
    const { base, clon } = await clonDelActivo('CLON-FRACCION', 2091, PCT);
    const factor = 1 + PCT / 100;

    const [rentasBase, rentasClon] = await Promise.all([
      prisma.rentalPrice.findMany({ where: { priceListId: base.id }, orderBy: [{ spaceId: 'asc' }, { min: 'asc' }, { tipo: 'asc' }] }),
      prisma.rentalPrice.findMany({ where: { priceListId: clon.id }, orderBy: [{ spaceId: 'asc' }, { min: 'asc' }, { tipo: 'asc' }] }),
    ]);
    expect(rentasClon).toHaveLength(rentasBase.length);
    for (const [i, rc] of rentasClon.entries()) {
      const rb = rentasBase[i]!;
      for (const campo of ['viernes', 'viernesEspecial', 'sabado', 'domAJue'] as const) {
        expect(Number.isInteger(rc[campo])).toBe(true);
        expect(rc[campo]).toBe(Math.round(rb[campo] * factor));
      }
    }

    const brackets = await prisma.foodPackagePrice.findMany({ where: { package: { priceListId: clon.id } } });
    expect(brackets.length).toBeGreaterThan(0);
    expect(brackets.every((b) => Number.isInteger(b.pricePerPerson))).toBe(true);

    const addOns = await prisma.addOn.findMany({ where: { priceListId: clon.id } });
    expect(addOns.every((a) => Number.isInteger(a.price))).toBe(true);
  });

  it('clonar copia también los brackets de cada paquete', async () => {
    // Un paquete sin brackets es un paquete SIN PRECIO: el motor no lo puede
    // cotizar. Olvidarlos es peor que no haber clonado nada.
    const { base, clon } = await clonDelActivo('CLON-BRACKETS', 2096);
    const pkgs = await prisma.foodPackage.findMany({
      where: { priceListId: clon.id },
      include: { brackets: true },
    });
    expect(pkgs.length).toBeGreaterThan(0);
    expect(pkgs.every((p) => p.brackets.length > 0)).toBe(true);

    const bracketsBase = await prisma.foodPackagePrice.count({ where: { package: { priceListId: base.id } } });
    const bracketsClon = await prisma.foodPackagePrice.count({ where: { package: { priceListId: clon.id } } });
    expect(bracketsClon).toBe(bracketsBase);
  });

  it('activar uno desactiva los demás', async () => {
    const { base, clon } = await clonDelActivo('CLON-ACTIVO', 2095);
    try {
      const activado = await activarCatalogo(prisma, clon.id);
      expect(activado.activa).toBe(true);
      expect(await prisma.priceList.count({ where: { activa: true } })).toBe(1);
    } finally {
      await activarCatalogo(prisma, base.id);
    }
  });

  it('activar un catálogo inexistente da 404', async () => {
    await expect(activarCatalogo(prisma, 'no-existe')).rejects.toMatchObject({ status: 404 });
  });

  it('el nombre es único', async () => {
    const base = await activo();
    await expect(
      clonarCatalogo(prisma, { nombre: base.nombre, anio: 2094, clonarDe: base.id }),
    ).rejects.toThrow();
    // Y el rechazo no dejó un catálogo a medias con otro nombre.
    expect(await prisma.priceList.count({ where: { anio: 2094 } })).toBe(0);
  });

  it('clonar de un catálogo inexistente da 404 y no crea nada', async () => {
    await expect(
      clonarCatalogo(prisma, { nombre: `CLON-HUERFANO-${SUF}`, anio: 2090, clonarDe: 'no-existe' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await prisma.priceList.count({ where: { anio: 2090 } })).toBe(0);
  });

  it('lista los catálogos con cuántas cotizaciones usa cada uno', async () => {
    const items = await listarCatalogos(prisma);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((c) => typeof c.cotizaciones === 'number')).toBe(true);
    expect(items.every((c) => typeof c.renta === 'number')).toBe(true);
    expect(items.every((c) => typeof c.servicios === 'number')).toBe(true);
    expect(items.every((c) => typeof c.paquetes === 'number')).toBe(true);
  });
});

describe('catálogos HTTP', () => {
  async function adminCookie() {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
    });
    const cookie = login.cookies[0]!;
    return { [cookie.name]: cookie.value };
  }

  it('un admin lista y clona por HTTP', async () => {
    const cookies = await adminCookie();
    const base = await activo();

    const lista = await app.inject({ method: 'GET', url: '/api/admin/price-lists', cookies });
    expect(lista.statusCode).toBe(200);
    expect(lista.json().priceLists.length).toBeGreaterThan(0);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/price-lists',
      cookies,
      payload: { nombre: `CLON-HTTP-${SUF}`, anio: 2089, clonarDe: base.id, incrementoPct: 8 },
    });
    expect(res.statusCode).toBe(201);
    creados.push(res.json().priceList.id);
    expect(res.json().priceList.activa).toBe(false);
  });

  it('solo admin puede clonar o activar', async () => {
    const cookies = await ventasCookie();
    const base = await activo();

    const post = await app.inject({
      method: 'POST',
      url: '/api/admin/price-lists',
      cookies,
      payload: { nombre: `CLON-VENTAS-${SUF}`, anio: 2093 },
    });
    expect(post.statusCode).toBe(403);

    const activar = await app.inject({
      method: 'POST',
      url: `/api/admin/price-lists/${base.id}/activar`,
      cookies,
      payload: {},
    });
    expect(activar.statusCode).toBe(403);

    // El vendedor tampoco se enteró de que existen.
    expect((await app.inject({ method: 'GET', url: '/api/admin/price-lists', cookies })).statusCode).toBe(403);
    expect(await prisma.priceList.count({ where: { nombre: `CLON-VENTAS-${SUF}` } })).toBe(0);
  });
});
