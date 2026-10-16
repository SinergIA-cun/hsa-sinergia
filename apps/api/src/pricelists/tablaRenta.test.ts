import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { COLUMNAS_BASE, type ColumnaRenta } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createQuote, type Actor } from '../quotes/service.js';
import { columnasDe, preciosDe } from '../catalog/loader.js';
import { clonarCatalogo } from './service.js';
import { guardarTablaRenta } from './tablaRenta.js';
import { borrarCatalogoDePrueba } from './testSupport.js';

/** La tabla de renta como hoja de cálculo: columnas con regla, rangos y precios (16-oct-2026). */

const SUF = randomUUID().slice(0, 8);
const ventasEmail = `ventas-tabla-${SUF}@test.local`;
let app: FastifyInstance;
let admin: Actor;
let activoId: string;
let arcosId: string;
let bodaId: string;
const creados: string[] = [];
const quotes: string[] = [];
const clients: string[] = [];

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  await prisma.user.create({ data: { nombre: 'Ventas tabla', email: ventasEmail, passwordHash: await hashPassword('ventas1234'), role: 'ventas' } });
  activoId = (await prisma.priceList.findFirstOrThrow({ where: { activa: true } })).id;
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  for (const id of creados) await borrarCatalogoDePrueba(prisma, id);
  await prisma.user.deleteMany({ where: { email: ventasEmail } });
  await app.close();
});

async function catalogo(nombre: string) {
  const c = await clonarCatalogo(prisma, { nombre: `${nombre}-${SUF}`, clonarDe: activoId });
  creados.push(c.id);
  return c;
}

/** La tabla tal cual está, lista para modificar y mandar. */
async function tabla(priceListId: string) {
  const [renglones, cols] = await Promise.all([
    prisma.rentalPrice.findMany({ where: { priceListId }, orderBy: [{ spaceId: 'asc' }, { tipo: 'asc' }, { min: 'asc' }] }),
    columnasDe(prisma, priceListId),
  ]);
  return {
    columnas: (cols.length ? cols : [...COLUMNAS_BASE]).map((c) => ({ ...c })) as ColumnaRenta[],
    renglones: renglones.map((r) => ({
      id: r.id as string | undefined,
      spaceId: r.spaceId,
      tipo: r.tipo as 'dia' | 'plano',
      min: r.min,
      max: r.max,
      precios: preciosDe(r.precios),
    })),
  };
}

async function cotizar(priceListId: string, fecha: string, invitados = 150) {
  const q = await createQuote(
    prisma,
    { fecha, invitados, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Tabla Renta', telefono: '5512340000' } },
    admin,
    { priceListId },
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

const arcos150 = (t: Awaited<ReturnType<typeof tabla>>) =>
  t.renglones.find((r) => r.spaceId === arcosId && r.tipo === 'dia' && r.min <= 150 && (r.max ?? Infinity) >= 150)!;

describe('precios', () => {
  it('cambia una celda sin tocar las demás y deja el antes/después en la bitácora', async () => {
    const cat = await catalogo('TABLA-PRECIO');
    const t = await tabla(cat.id);
    const r = arcos150(t);
    const sabadoAntes = r.precios.sabado ?? null;
    r.precios.sabado = 99_000;
    await guardarTablaRenta(prisma, cat.id, t, admin);

    const despues = await tabla(cat.id);
    expect(arcos150(despues).precios.sabado).toBe(99_000);
    expect(arcos150(despues).precios.viernes).toBe(r.precios.viernes);
    const log = await prisma.priceListAudit.findFirstOrThrow({ where: { priceListId: cat.id } });
    expect(log.meta).toMatchObject({ celdas: [{ id: r.id, columna: 'Sábado', antes: sabadoAntes, despues: 99_000 }] });
  });

  it('rechaza negativos y centavos (Prisma trunca los flotantes)', async () => {
    const cat = await catalogo('TABLA-MAL');
    const t = await tabla(cat.id);
    arcos150(t).precios.sabado = -1;
    await expect(guardarTablaRenta(prisma, cat.id, t, admin)).rejects.toThrow();
    arcos150(t).precios.sabado = 1234.5;
    await expect(guardarTablaRenta(prisma, cat.id, t, admin)).rejects.toThrow();
  });

  it('rechaza un renglón de otro catálogo', async () => {
    const cat = await catalogo('TABLA-AJENA');
    const t = await tabla(cat.id);
    const ajeno = await prisma.rentalPrice.findFirstOrThrow({ where: { priceListId: activoId } });
    t.renglones[0]!.id = ajeno.id;
    await expect(guardarTablaRenta(prisma, cat.id, t, admin)).rejects.toMatchObject({ status: 400 });
  });
});

describe('columnas con regla', () => {
  it('una columna nueva "Diciembre" (vie y sáb de diciembre) cobra esos días', async () => {
    const cat = await catalogo('TABLA-DIC');
    const t = await tabla(cat.id);
    t.columnas.push({ clave: 'dic', nombre: 'Diciembre', dias: [5, 6], meses: [12], respaldo: null });
    for (const r of t.renglones) r.precios.dic = 200_000;
    await guardarTablaRenta(prisma, cat.id, t, admin);

    expect((await cotizar(cat.id, '2091-12-01')).rentaTotal).toBe(200_000); // sábado de diciembre
    expect((await cotizar(cat.id, '2091-12-07')).rentaTotal).toBe(200_000); // viernes de diciembre
    expect((await cotizar(cat.id, '2091-11-30')).rentaTotal).toBe(arcos150(t).precios.viernes); // viernes de noviembre: columna Viernes
  });

  it('dos columnas igual de específicas para el mismo día no se pueden guardar', async () => {
    const cat = await catalogo('TABLA-EMPATE');
    const t = await tabla(cat.id);
    t.columnas.push({ clave: 'otroSabado', nombre: 'Otro sábado', dias: [6], meses: [], respaldo: null });
    await expect(guardarTablaRenta(prisma, cat.id, t, admin)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('sábado'),
    });
  });

  it('borrar una columna deja esos días sin ofrecer', async () => {
    const cat = await catalogo('TABLA-SIN-SAB');
    const t = await tabla(cat.id);
    t.columnas = t.columnas.filter((c) => c.clave !== 'sabado');
    const res = await guardarTablaRenta(prisma, cat.id, t, admin);
    expect(res.avisos.join(' ')).toContain('sábado');
    await expect(cotizar(cat.id, '2091-12-01')).rejects.toMatchObject({ message: expect.stringContaining('no se ofrece en sábado') });
  });
});

describe('rangos', () => {
  it('se parten y se quitan; un hueco no se puede guardar', async () => {
    const cat = await catalogo('TABLA-RANGOS');
    const t = await tabla(cat.id);
    const r = arcos150(t);
    // Partir 101–200 en 101–150 y 151–200.
    const max = r.max!;
    r.max = 150;
    t.renglones.push({ id: undefined, spaceId: arcosId, tipo: 'dia', min: 151, max, precios: { sabado: 1, viernes: 1, domAJue: 1 } });
    await guardarTablaRenta(prisma, cat.id, t, admin);
    expect((await cotizar(cat.id, '2091-12-08', 180)).rentaTotal).toBe(1);

    const t2 = await tabla(cat.id);
    t2.renglones = t2.renglones.filter((x) => !(x.spaceId === arcosId && x.tipo === 'dia' && x.min === 151));
    await expect(guardarTablaRenta(prisma, cat.id, t2, admin)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('hueco'),
    });
  });
});

describe('catálogo en uso', () => {
  it('solo cambia precios y nombres de columna; la estructura no', async () => {
    const cat = await catalogo('TABLA-USO');
    await cotizar(cat.id, '2091-12-15');
    const t = await tabla(cat.id);
    arcos150(t).precios.sabado = 77_000;
    t.columnas.find((c) => c.clave === 'sabado')!.nombre = 'Sábados';
    await expect(guardarTablaRenta(prisma, cat.id, t, admin)).resolves.toBeTruthy();

    const t2 = await tabla(cat.id);
    t2.columnas.push({ clave: 'dic', nombre: 'Diciembre', dias: [6], meses: [12], respaldo: null });
    await expect(guardarTablaRenta(prisma, cat.id, t2, admin)).rejects.toMatchObject({ status: 409 });
    const t3 = await tabla(cat.id);
    t3.renglones.pop();
    await expect(guardarTablaRenta(prisma, cat.id, t3, admin)).rejects.toMatchObject({ status: 409 });
  });
});

describe('HTTP', () => {
  it('PUT /renta es solo de admin', async () => {
    const cat = await catalogo('TABLA-HTTP');
    const t = await tabla(cat.id);
    const login = async (email: string, password: string) => {
      const c = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })).cookies[0]!;
      return { [c.name]: c.value };
    };
    const url = `/api/admin/price-lists/${cat.id}/renta`;
    expect((await app.inject({ method: 'PUT', url, payload: t, cookies: await login(ventasEmail, 'ventas1234') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url, payload: t, cookies: await login('admin@haciendasanandres.com.mx', 'admin1234') })).statusCode).toBe(200);
  });
});
