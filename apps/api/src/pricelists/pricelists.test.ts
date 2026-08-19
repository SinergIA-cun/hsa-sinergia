import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { clonarCatalogo, activarCatalogo, listarCatalogos } from './service.js';
import { contenidoDeCatalogo } from './contenido.js';

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
  await prisma.djHoraExtraPrice.deleteMany({ where: { priceListId: { in: creados } } });
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
    // Los precios son enteros de pesos. Un flotante no llega a Postgres: el query
    // engine de Prisma lo TRUNCA antes de mandarlo (5.5 → 5), que no es lo que hace
    // `Math.round`, así que el catálogo nuevo quedaría un peso abajo en cada
    // renglón con fracción.
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

  it('clonar sube el precio del DJ con el mismo porcentaje (2,950 +8% = 3,186)', async () => {
    // El DJ era la última puerta de atrás: un precio global que el clon dejaba
    // igual mientras la renta subía 8%.
    const { base, clon } = await clonDelActivo('CLON-DJ', 2087, 8);
    const boda = await prisma.eventType.findUniqueOrThrow({ where: { slug: 'boda' } });

    const djBase = await prisma.djHoraExtraPrice.findUniqueOrThrow({
      where: { priceListId_eventTypeId: { priceListId: base.id, eventTypeId: boda.id } },
    });
    const djClon = await prisma.djHoraExtraPrice.findUniqueOrThrow({
      where: { priceListId_eventTypeId: { priceListId: clon.id, eventTypeId: boda.id } },
    });
    expect(djBase.price).toBe(2950);
    expect(djClon.price).toBe(3186); // Math.round(2950 × 1.08)

    // Y viaja el renglón de CADA tipo de evento que lo ofrece, ni uno más.
    expect(await prisma.djHoraExtraPrice.count({ where: { priceListId: clon.id } })).toBe(
      await prisma.djHoraExtraPrice.count({ where: { priceListId: base.id } }),
    );
  });

  it('el tipo de evento SIN DJ sigue sin DJ en el clon', async () => {
    // Darle renglón al clonar haría que una graduación empezara a cobrar DJ
    // nada más por crear el catálogo del año que viene.
    const { clon } = await clonDelActivo('CLON-DJ-NULO', 2086, 8);
    const grad = await prisma.eventType.findUniqueOrThrow({ where: { slug: 'graduacion' } });
    expect(
      await prisma.djHoraExtraPrice.count({ where: { priceListId: clon.id, eventTypeId: grad.id } }),
    ).toBe(0);
  });

  /**
   * Qué hace de verdad un flotante en una columna `Int`. Existía un comentario en
   * este mismo repo que decía que **Postgres** lo redondeaba a la mitad PAR
   * (2.5 → 2, 3.5 → 4); era falso por el camino que importa. El query engine de
   * Prisma lo TRUNCA antes de mandarlo, así que Postgres nunca ve el flotante.
   *
   * Los dos casos que distinguen: 5.5 y 3.5. Truncar da 5 y 3; la mitad par daría
   * 6 y 4. Este test es el que evita que el comentario vuelva a mentir.
   */
  it('Prisma TRUNCA un flotante en una columna Int (no lo redondea a la mitad par)', async () => {
    const { clon } = await clonDelActivo('CLON-TRUNCA', 2079);
    const espacio = await prisma.space.findFirstOrThrow();
    const r = await prisma.rentalPrice.create({
      data: {
        priceListId: clon.id,
        spaceId: espacio.id,
        min: 0,
        max: 10,
        // Deliberadamente flotantes: es el escenario que el `Math.round` de
        // `service.ts` y el `int()` de `editar.ts` existen para impedir.
        viernes: 5.5,
        viernesEspecial: 3.5,
        sabado: 2.5,
        domAJue: 1234.5,
      },
    });
    expect([r.viernes, r.viernesEspecial, r.sabado, r.domAJue]).toEqual([5, 3, 2, 1234]);

    // Y para dejar constancia de con qué se confundía: el cast de Postgres, cuando
    // SÍ le toca hacerlo, redondea a la mitad par. Ese camino no ocurre vía Prisma.
    const [pg] = await prisma.$queryRaw<{ a: number; b: number }[]>`
      SELECT (5.5::float8)::int AS a, (3.5::float8)::int AS b
    `;
    expect([pg!.a, pg!.b]).toEqual([6, 4]);
  });

  it('el incremento del DJ nunca mete un flotante a la base', async () => {
    // Prisma NO rechaza un flotante en una columna Int: lo TRUNCA (5.5 → 5) y lo
    // manda ya entero, así que el precio sale un peso abajo SIN error.
    // 2950 × 1.073 = 3165.35 → Math.round = 3165.
    const PCT = 7.3;
    const { base, clon } = await clonDelActivo('CLON-DJ-FRACCION', 2085, PCT);
    const factor = 1 + PCT / 100;

    const [djBase, djClon] = await Promise.all([
      prisma.djHoraExtraPrice.findMany({ where: { priceListId: base.id }, orderBy: { eventTypeId: 'asc' } }),
      prisma.djHoraExtraPrice.findMany({ where: { priceListId: clon.id }, orderBy: { eventTypeId: 'asc' } }),
    ]);
    expect(djClon).toHaveLength(djBase.length);
    expect(djClon.length).toBeGreaterThan(0);
    for (const [i, d] of djClon.entries()) {
      expect(Number.isInteger(d.price)).toBe(true);
      expect(d.price).toBe(Math.round(djBase[i]!.price * factor));
    }
  });

  it('el listado trae el precio del DJ con el nombre del tipo de evento', async () => {
    const items = await listarCatalogos(prisma);
    const activoListado = items.find((c) => c.activa);
    expect(activoListado).toBeDefined();
    const boda = activoListado!.dj.find((d) => d.eventType === 'Boda');
    expect(boda?.price).toBe(2950);
    // Los que no lo ofrecen no aparecen: sin renglón = no hay servicio.
    expect(activoListado!.dj.some((d) => d.eventType === 'Graduación')).toBe(false);
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

  it('el contenido es del catálogo PEDIDO, con los ids que el editor necesita', async () => {
    const cookies = await adminCookie();
    const { base, clon } = await clonDelActivo('CONTENIDO', 2084, 10);

    const res = await app.inject({ method: 'GET', url: `/api/admin/price-lists/${clon.id}/contenido`, cookies });
    expect(res.statusCode).toBe(200);
    const c = res.json().contenido as {
      priceList: { id: string; nombre: string; ivaRate: number };
      renta: { id: string; espacio: string; tipo: string; sabado: number; spaceId: string; min: number }[];
      servicios: { id: string; activo: boolean }[];
      paquetes: { id: string; brackets: { min: number; pricePerPerson: number }[] }[];
      dj: { eventTypeId: string; price: number }[];
      eventTypes: { id: string; nombre: string }[];
    };

    expect(c.priceList.id).toBe(clon.id);
    // Los renglones traen su `id` de `RentalPrice` —sin él no hay PATCH posible—
    // y el NOMBRE del espacio, porque un cuid no le dice nada a quien edita.
    expect(c.renta.length).toBeGreaterThan(0);
    expect(c.renta.every((r) => typeof r.id === 'string' && r.id.length > 0)).toBe(true);
    expect(c.renta.every((r) => typeof r.espacio === 'string' && r.espacio.length > 0)).toBe(true);
    // Y el `tipo`: la renta plana (Team Building) vive en el mismo catálogo.
    expect(c.renta.some((r) => r.tipo === 'plano')).toBe(true);
    expect(c.renta.some((r) => r.tipo === 'dia')).toBe(true);

    // Es del clon (+10%), no del activo: leer el activo por descuido es
    // exactamente cómo se edita el catálogo equivocado.
    const rb = await prisma.rentalPrice.findFirstOrThrow({ where: { priceListId: base.id }, orderBy: { id: 'asc' } });
    const rc = c.renta.find((r) => r.spaceId === rb.spaceId && r.min === rb.min && r.tipo === rb.tipo);
    expect(rc?.sabado).toBe(Math.round(rb.sabado * 1.1));

    expect(c.paquetes.length).toBeGreaterThan(0);
    expect(c.paquetes.every((p) => p.brackets.length > 0)).toBe(true);
    expect(c.dj.length).toBeGreaterThan(0);
    expect(c.eventTypes.length).toBeGreaterThan(0);
  });

  it('el contenido trae también los servicios dados de baja', async () => {
    // El editor tiene que poder REACTIVAR lo que desactivó. Si el endpoint
    // esconde los `activo: false`, la baja es un camino de una sola vía.
    const cookies = await adminCookie();
    const { clon } = await clonDelActivo('CONTENIDO-BAJA', 2083);
    const baja = await prisma.addOn.create({
      data: { nombre: 'ZZZ Servicio de baja', kind: 'fijo', price: 100, activo: false, priceListId: clon.id },
    });

    const res = await app.inject({ method: 'GET', url: `/api/admin/price-lists/${clon.id}/contenido`, cookies });
    const servicios = res.json().contenido.servicios as { id: string; activo: boolean }[];
    expect(servicios.find((s) => s.id === baja.id)?.activo).toBe(false);
    expect(servicios.some((s) => s.activo)).toBe(true);
  });

  it('el contenido de un catálogo inexistente da 404', async () => {
    await expect(contenidoDeCatalogo(prisma, 'no-existe')).rejects.toMatchObject({ status: 404 });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/price-lists/no-existe/contenido',
      cookies: await adminCookie(),
    });
    expect(res.statusCode).toBe(404);
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
    expect(
      (await app.inject({ method: 'GET', url: `/api/admin/price-lists/${base.id}/contenido`, cookies })).statusCode,
    ).toBe(403);
    expect(await prisma.priceList.count({ where: { nombre: `CLON-VENTAS-${SUF}` } })).toBe(0);
  });
});
