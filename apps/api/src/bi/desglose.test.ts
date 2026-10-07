import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import type { QuoteLine } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, updateQuote, seleccionGuardada, SELECCION_INCLUDE, type Actor } from '../quotes/service.js';
import { editarServicio } from '../pricelists/editar.js';
import { etiquetarDesgloses } from './etiquetarDesglose.js';

/**
 * Lo vendido de cada evento para el BI (issue #3 del canal): `desglose[]` con la
 * clave fija de cada cosa, el catálogo completo en `/catalogos`, el proveedor y
 * la comisión de cada servicio, y qué se agregó o quitó en cada edición.
 */

const LLAVE = 'd'.repeat(64);
const SUF = randomUUID().slice(0, 8);
let app: FastifyInstance;
let admin: Actor;
let adminCookie: Record<string, string>;
let arcosId: string;
let bodaId: string;
let catalogoId: string;
let paquete: { id: string; clave: string };
let servicio: { id: string; clave: string };
let proveedorId: string;
const quotes: string[] = [];

const get = async (url: string) => {
  const r = await app.inject({ method: 'GET', url, headers: { 'x-api-key': LLAVE } });
  expect(r.statusCode, url).toBe(200);
  return r.json();
};

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE } });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'admin1234' } });
  const c = login.cookies[0]!;
  adminCookie = { [c.name]: c.value };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  catalogoId = (await prisma.priceList.findFirstOrThrow({ where: { activa: true } })).id;
  paquete = await prisma.foodPackage.findFirstOrThrow({ where: { priceListId: catalogoId, eventTypeId: bodaId }, select: { id: true, clave: true } });
  servicio = await prisma.addOn.create({
    data: { priceListId: catalogoId, nombre: `Mesa de dulces BI ${SUF}`, categoria: 'Dulces', kind: 'porPersona', price: 110 },
    select: { id: true, clave: true },
  });
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.quote.updateMany({ where: { id: { in: quotes } }, data: { banqueteroId: null } });
  await prisma.banquetero.deleteMany({ where: { nombre: { contains: SUF } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await prisma.addOn.delete({ where: { id: servicio.id } });
  await prisma.priceListAudit.deleteMany({ where: { priceListId: catalogoId, descripcion: { contains: SUF } } });
  await prisma.proveedor.deleteMany({ where: { nombre: { contains: SUF } } });
  await app.close();
});

let semana = 0;
const sabado = () => new Date(Date.UTC(2055, 0, 2 + 7 * semana++)).toISOString().slice(0, 10);

async function evento(extra: Record<string, unknown> = {}) {
  const q = await createQuote(
    prisma,
    {
      fecha: sabado(),
      invitados: 200,
      spaceIds: [arcosId],
      eventTypeId: bodaId,
      foodPackageId: paquete.id,
      addOns: [{ addOnId: servicio.id, cantidad: 1 }],
      extras: [{ nombre: 'Tornaboda', kind: 'fijo', monto: 8000, cantidad: 1 }],
      client: { nombre: 'Desglose BI', telefono: '5513131313' },
      ...extra,
    },
    admin,
  );
  quotes.push(q.id);
  return q;
}

describe('proveedores', () => {
  it('un admin da de alta un proveedor; el nombre no se repite (sin importar mayúsculas)', async () => {
    const alta = await app.inject({ method: 'POST', url: '/api/admin/proveedores', cookies: adminCookie, payload: { nombre: `Dulces Lupita ${SUF}` } });
    expect(alta.statusCode).toBe(201);
    proveedorId = alta.json().proveedor.id;
    const otra = await app.inject({ method: 'POST', url: '/api/admin/proveedores', cookies: adminCookie, payload: { nombre: `DULCES LUPITA ${SUF}` } });
    expect(otra.statusCode).toBe(409);
    const sinSesion = await app.inject({ method: 'GET', url: '/api/admin/proveedores' });
    expect(sinSesion.statusCode).toBe(401);
  });

  it('el servicio del catálogo guarda su proveedor y comisión; un proveedor inventado es 400', async () => {
    await expect(editarServicio(prisma, catalogoId, servicio.id, { proveedorId: 'no-existe' }, admin)).rejects.toMatchObject({ status: 400 });
    await expect(editarServicio(prisma, catalogoId, servicio.id, { comisionPct: 120 }, admin)).rejects.toThrow();
    const a = await editarServicio(prisma, catalogoId, servicio.id, { proveedorId, comisionPct: 10 }, admin);
    expect(a).toMatchObject({ proveedorId, comisionPct: 10 });
  });
});

describe('desglose del BI', () => {
  it('/eventos trae cada cosa vendida con su clave, y los renglones suman renta + otros', async () => {
    const q = await evento();
    const [ev] = (await get(`/api/bi/eventos?ids=${q.id}`)).datos;
    const porTipo = (t: string) => ev.desglose.filter((r: { tipo: string }) => r.tipo === t);

    expect(porTipo('rentaSalon')).toEqual([expect.objectContaining({ bloque: 'renta', clave: arcosId, cantidad: 1 })]);
    expect(porTipo('alimentos')).toEqual([expect.objectContaining({ bloque: 'otros', clave: paquete.clave, cantidad: 200, unidad: 'personas' })]);
    const [dulces] = porTipo('servicioCatalogo');
    expect(dulces).toMatchObject({
      id: `${q.id}:servicioCatalogo:${servicio.id}`,
      clave: servicio.clave,
      categoria: 'Dulces',
      cantidad: 200,
      unidad: 'personas',
      precioUnitario: 127.6,
      subtotal: 22000,
      total: 25520,
      origen: 'contrato',
      proveedor: { clave: proveedorId, nombre: `Dulces Lupita ${SUF}` },
      comision: { porcentaje: 10, monto: 2200 },
      cobra: 'proveedor',
      banquetero: null,
    });
    expect(porTipo('servicioEvento')).toEqual([
      expect.objectContaining({ nombre: 'Tornaboda', clave: null, total: 8000, proveedor: null, comision: null }),
    ]);

    const suma = (b: string) =>
      Math.round(ev.desglose.filter((r: { bloque: string }) => r.bloque === b).reduce((s: number, r: { total: number }) => s + r.total, 0) * 100) / 100;
    expect(suma('renta')).toBe(ev.renta.total);
    expect(suma('otros')).toBe(ev.otros.total);
  });

  it('/catalogos trae servicios, paquetes y proveedores con sus claves', async () => {
    const c = await get('/api/bi/catalogos');
    expect(c.servicios).toContainEqual(
      expect.objectContaining({ id: servicio.id, clave: servicio.clave, catalogoId, categoria: 'Dulces', tipoCobro: 'porPersona', unidad: 'personas', precio: 110, comisionPct: 10, proveedor: { clave: proveedorId, nombre: `Dulces Lupita ${SUF}` } }),
    );
    expect(c.paquetesAlimentos).toContainEqual(expect.objectContaining({ id: paquete.id, clave: paquete.clave, catalogoId }));
    expect(c.proveedores).toContainEqual({ clave: proveedorId, nombre: `Dulces Lupita ${SUF}`, activo: true });
    expect(c.catalogos).toContainEqual(expect.objectContaining({ id: catalogoId, activo: true }));
  });

  it('una edición que quita un servicio y agrega otro lo dice en meta.servicios', async () => {
    const q = await evento();
    const guardada = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: SELECCION_INCLUDE });
    await updateQuote(
      prisma,
      q.id,
      { ...seleccionGuardada(guardada), addOns: [], extras: [{ nombre: 'Tornaboda', kind: 'fijo', monto: 8000, cantidad: 1 }, { nombre: 'Barra libre', kind: 'fijo', monto: 15000, cantidad: 1 }] },
      admin,
    );
    const log = await prisma.activityLog.findFirstOrThrow({ where: { quoteId: q.id, tipo: 'edicion' }, orderBy: { createdAt: 'desc' } });
    const servicios = (log.meta as { servicios: Record<string, unknown[]> }).servicios;
    expect(servicios.quitados).toEqual([expect.objectContaining({ tipo: 'servicioCatalogo', id: servicio.id, clave: servicio.clave })]);
    expect(servicios.agregados).toEqual([expect.objectContaining({ tipo: 'servicioEvento', nombre: 'Barra libre' })]);
    expect(servicios.cambiados).toEqual([]);
  });

  it('un desglose guardado sin etiquetas se etiqueta al arrancar, sin mover montos', async () => {
    const q = await evento();
    const original = (await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).breakdown as unknown as { lines: QuoteLine[] };
    const sinRef = original.lines.map((l) => {
      const copia = { ...l };
      delete copia.ref;
      return copia;
    });
    await prisma.quote.update({ where: { id: q.id }, data: { breakdown: { ...original, lines: sinRef } as never } });

    const r = await etiquetarDesgloses(prisma);
    expect(r.etiquetados).toBeGreaterThanOrEqual(1);
    expect(r.sinEmparejar).not.toContain(q.etiqueta);
    const despues = (await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).breakdown as unknown as { lines: QuoteLine[] };
    expect(despues.lines).toEqual(original.lines);
  });
});

describe('comisión congelada, quién cobra y servicios del banquetero', () => {
  const desgloseDe = async (id: string) => (await get(`/api/bi/eventos?ids=${id}`)).datos[0];
  const dulcesDe = (ev: { desglose: { tipo: string }[] }) => ev.desglose.find((r) => r.tipo === 'servicioCatalogo')!;

  it('el evento se queda con el % y quién cobra con que se vendió, aunque cambie el catálogo', async () => {
    const q = await evento();
    await editarServicio(prisma, catalogoId, servicio.id, { comisionPct: 20, cobra: 'hacienda' }, admin);
    try {
      expect(dulcesDe(await desgloseDe(q.id))).toMatchObject({ cobra: 'proveedor', comision: { porcentaje: 10, monto: 2200 } });
      // Uno nuevo se vende con lo de hoy.
      const nuevo = await evento();
      expect(dulcesDe(await desgloseDe(nuevo.id))).toMatchObject({ cobra: 'hacienda', comision: { porcentaje: 20, monto: 4400 } });
      const c = await get('/api/bi/catalogos');
      expect(c.servicios.find((x: { id: string }) => x.id === servicio.id)).toMatchObject({ cobra: 'hacienda', comisionPct: 20 });
    } finally {
      await editarServicio(prisma, catalogoId, servicio.id, { comisionPct: 10, cobra: 'proveedor' }, admin);
    }
  });

  it('un evento guardado sin congelar toma lo del catálogo al arrancar', async () => {
    const q = await evento();
    const b = (await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).breakdown as unknown as { lines: QuoteLine[] };
    const viejas = b.lines.map((l) => {
      if (l.ref?.tipo !== 'servicioCatalogo') return l;
      const ref = { ...l.ref };
      delete ref.proveedorId;
      delete ref.comisionPct;
      delete ref.cobra;
      return { ...l, ref };
    });
    await prisma.quote.update({ where: { id: q.id }, data: { breakdown: { ...b, lines: viejas } as never } });
    await etiquetarDesgloses(prisma);
    const despues = (await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).breakdown as unknown as { lines: QuoteLine[] };
    expect(despues.lines).toEqual(b.lines);
  });

  it('lo que pone el banquetero va en su propio bloque y no mueve los totales', async () => {
    const ban = await prisma.banquetero.create({ data: { nombre: `Banquetes ${SUF}`, telefono: '5514141414' } });
    const q = await evento({
      banqueteroId: ban.id,
      serviciosBanquetero: [
        { nombre: 'Banquete 3 tiempos', cantidad: 200, monto: 160000 },
        { nombre: 'Mesa de quesos', cantidad: 1 },
      ],
    });
    const ev = await desgloseDe(q.id);
    const suyos = ev.desglose.filter((r: { bloque: string }) => r.bloque === 'banquetero');
    expect(suyos).toEqual([
      expect.objectContaining({ id: `${q.id}:servicioBanquetero:1`, tipo: 'servicioBanquetero', nombre: 'Banquete 3 tiempos', cantidad: 200, precioUnitario: 800, total: 160000, banquetero: { id: ban.id, nombre: `Banquetes ${SUF}` } }),
      expect.objectContaining({ nombre: 'Mesa de quesos', cantidad: 1, precioUnitario: null, total: null }),
    ]);
    const suma = (bl: string) =>
      Math.round(ev.desglose.filter((r: { bloque: string }) => r.bloque === bl).reduce((s: number, r: { total: number }) => s + r.total, 0) * 100) / 100;
    expect(suma('renta')).toBe(ev.renta.total);
    expect(suma('otros')).toBe(ev.otros.total);
    expect(ev.total).toBe(ev.renta.total + ev.otros.total);

    // Editar sin mandarlos los deja; mandarlos los reemplaza y queda en la bitácora.
    const guardada = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: SELECCION_INCLUDE });
    await updateQuote(prisma, q.id, { ...seleccionGuardada(guardada), invitados: 210 }, admin);
    expect(await prisma.servicioBanquetero.count({ where: { quoteId: q.id } })).toBe(2);
    await updateQuote(prisma, q.id, { ...seleccionGuardada(guardada), serviciosBanquetero: [{ nombre: 'Banquete 3 tiempos', cantidad: 200, monto: 170000 }] }, admin);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { quoteId: q.id, tipo: 'edicion' }, orderBy: { createdAt: 'desc' } });
    const servicios = (log.meta as { servicios: Record<string, unknown[]> }).servicios;
    expect(servicios.quitados).toEqual([expect.objectContaining({ tipo: 'servicioBanquetero', nombre: 'Mesa de quesos' })]);
    expect(servicios.cambiados).toEqual([expect.objectContaining({ tipo: 'servicioBanquetero', detalle: { cantidad: 200, monto: 170000 }, antes: { cantidad: 200, monto: 160000 } })]);

    // Sin banquetero, se van.
    await updateQuote(prisma, q.id, { ...seleccionGuardada(guardada), banqueteroId: null }, admin);
    expect(await prisma.servicioBanquetero.count({ where: { quoteId: q.id } })).toBe(0);
  });
});
