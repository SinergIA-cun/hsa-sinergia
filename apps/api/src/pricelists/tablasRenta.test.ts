import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { COLUMNAS_BASE, MENSAJE_SIN_TABLA, type ColumnaRenta } from '@hsa/shared';
import { createQuote, type Actor } from '../quotes/service.js';
import { columnasDe, loadCatalog, preciosDe, tablasDe } from '../catalog/loader.js';
import { clonarCatalogo } from './service.js';
import { guardarTablaRenta } from './tablaRenta.js';
import { borrarCatalogoDePrueba } from './testSupport.js';

/**
 * Tablas de renta por catálogo (21-oct-2026): cada hoja con su nombre y los
 * tipos de evento que se cobran con ella; crear, renombrar y borrar; aviso del
 * tipo que se queda sin tabla.
 */

const SUF = randomUUID().slice(0, 8);
let admin: Actor;
let activoId: string;
let arcosId: string;
let bodaId: string;
let graduacionId: string;
let teamBuildingId: string;
const creados: string[] = [];
const quotes: string[] = [];
const clients: string[] = [];

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  activoId = (await prisma.priceList.findFirstOrThrow({ where: { activa: true } })).id;
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  graduacionId = (await prisma.eventType.findFirstOrThrow({ where: { nombre: 'Graduación' } })).id;
  teamBuildingId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'team-building' } })).id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  for (const id of creados) await borrarCatalogoDePrueba(prisma, id);
});

async function catalogo(nombre: string) {
  const c = await clonarCatalogo(prisma, { nombre: `${nombre}-${SUF}`, clonarDe: activoId });
  creados.push(c.id);
  return c;
}

/** La renta tal cual está, con sus tablas, lista para modificar y mandar. */
async function hoja(priceListId: string) {
  const [renglones, cols, tablas] = await Promise.all([
    prisma.rentalPrice.findMany({ where: { priceListId }, orderBy: [{ spaceId: 'asc' }, { tipo: 'asc' }, { min: 'asc' }] }),
    columnasDe(prisma, priceListId),
    tablasDe(prisma, priceListId),
  ]);
  return {
    columnas: (cols.length ? cols : [...COLUMNAS_BASE]).map((c) => ({ ...c })) as ColumnaRenta[],
    tablas: tablas.map((t) => ({ ...t, eventTypeIds: [...t.eventTypeIds] })),
    renglones: renglones.map((r) => ({
      id: r.id as string | undefined,
      spaceId: r.spaceId,
      tipo: r.tipo,
      min: r.min,
      max: r.max,
      precios: preciosDe(r.precios),
    })),
  };
}

async function cotizar(priceListId: string, eventTypeId: string, fecha: string) {
  const q = await createQuote(
    prisma,
    { fecha, invitados: 150, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Tablas Renta', telefono: '5512340000' } },
    admin,
    { priceListId },
  );
  quotes.push(q.id);
  clients.push(q.clientId!);
  return q;
}

describe('tablas de renta', () => {
  it('el clon trae las tablas del original y Team Building se cobra con la plana', async () => {
    const cat = await catalogo('TABLAS-CLON');
    const tablas = await tablasDe(prisma, cat.id);
    expect(tablas.map((t) => t.clave)).toEqual(['dia', 'plano']);
    expect(tablas.find((t) => t.clave === 'plano')!.eventTypeIds).toEqual([teamBuildingId]);
    expect(tablas.find((t) => t.clave === 'dia')!.eventTypeIds).toContain(bodaId);
    const motor = await loadCatalog(prisma, { priceListId: cat.id });
    expect(motor.tablasRenta?.map((t) => t.rows.length)).toEqual([
      motor.rentalPrices.length,
      motor.rentalPricesFlat.length,
    ]);
  });

  it('una tabla nueva para Graduación le cobra con sus precios; la boda sigue con la de siempre', async () => {
    const cat = await catalogo('TABLAS-NUEVA');
    const h = await hoja(cat.id);
    const dia = h.tablas.find((t) => t.clave === 'dia')!;
    dia.eventTypeIds = dia.eventTypeIds.filter((id) => id !== graduacionId);
    h.tablas.push({ clave: 'grad', nombre: 'Graduaciones', eventTypeIds: [graduacionId] });
    for (const r of h.renglones.filter((x) => x.tipo === 'dia' && x.spaceId === arcosId)) {
      h.renglones.push({ id: undefined, spaceId: r.spaceId, tipo: 'grad', min: r.min, max: r.max, precios: { sabado: 11_111 } });
    }
    await guardarTablaRenta(prisma, cat.id, h, admin);

    expect((await cotizar(cat.id, graduacionId, '2093-06-13')).rentaTotal).toBe(11_111); // sábado
    expect((await cotizar(cat.id, bodaId, '2093-06-20')).rentaTotal).not.toBe(11_111);
    const log = await prisma.priceListAudit.findFirstOrThrow({ where: { priceListId: cat.id }, orderBy: { createdAt: 'desc' } });
    expect(log.descripcion).toContain('tablas nuevas: Graduaciones');
  });

  it('renombrar una tabla es solo el nombre', async () => {
    const cat = await catalogo('TABLAS-NOMBRE');
    const h = await hoja(cat.id);
    h.tablas.find((t) => t.clave === 'plano')!.nombre = 'Team Building';
    await guardarTablaRenta(prisma, cat.id, h, admin);
    expect((await tablasDe(prisma, cat.id)).map((t) => t.nombre)).toEqual(['Renta', 'Team Building']);
  });

  it('un tipo de evento no puede ir en dos tablas', async () => {
    const cat = await catalogo('TABLAS-DOBLE');
    const h = await hoja(cat.id);
    h.tablas.find((t) => t.clave === 'plano')!.eventTypeIds.push(bodaId);
    await expect(guardarTablaRenta(prisma, cat.id, h, admin)).rejects.toMatchObject({ status: 400 });
  });

  it('borrar una tabla se lleva sus renglones y avisa qué tipo se quedó sin tabla', async () => {
    const cat = await catalogo('TABLAS-BORRAR');
    const h = await hoja(cat.id);
    h.tablas = h.tablas.filter((t) => t.clave !== 'plano');
    h.renglones = h.renglones.filter((r) => r.tipo !== 'plano');
    const r = await guardarTablaRenta(prisma, cat.id, h, admin);
    expect(r.sinTabla).toEqual(['Team Building']);
    expect(await prisma.rentalPrice.count({ where: { priceListId: cat.id, tipo: 'plano' } })).toBe(0);
    await expect(cotizar(cat.id, teamBuildingId, '2093-07-04')).rejects.toThrow(MENSAJE_SIN_TABLA);
  });

  it('en un catálogo en uso se renombra, pero no se cambian los eventos de una tabla', async () => {
    const cat = await catalogo('TABLAS-USO');
    await cotizar(cat.id, bodaId, '2093-08-01');
    const h = await hoja(cat.id);
    h.tablas[0]!.nombre = 'Renta normal';
    await guardarTablaRenta(prisma, cat.id, h, admin);
    h.tablas[0]!.eventTypeIds = h.tablas[0]!.eventTypeIds.filter((id) => id !== graduacionId);
    await expect(guardarTablaRenta(prisma, cat.id, h, admin)).rejects.toMatchObject({ status: 409 });
  });
});
