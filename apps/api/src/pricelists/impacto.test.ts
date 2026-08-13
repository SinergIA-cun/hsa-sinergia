import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { clonarCatalogo } from './service.js';
import { impactoDeCatalogo, ESTATUS_COMPROMETIDOS } from './impacto.js';
import { registrarCambioCatalogo, listarBitacoraCatalogo } from './audit.js';
import { borrarCatalogoDePrueba } from './testSupport.js';

/** El nombre del catálogo es `@unique`: un sufijo por corrida evita envenenar la siguiente. */
const SUF = randomUUID().slice(0, 8);
let adminId: string;
let activoId: string;
const createdQuoteIds: string[] = [];
const createdClientIds: string[] = [];

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin@haciendasanandres.com.mx' },
  });
  adminId = admin.id;
  activoId = (await prisma.priceList.findFirstOrThrow({ where: { activa: true } })).id;
});

afterAll(async () => {
  await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
});

/** Clona el catálogo activo con nombre único; el llamador lo borra. */
async function clonVacio(nombre: string, anio: number) {
  return clonarCatalogo(prisma, {
    nombre: `${nombre}-${SUF}`,
    anio,
    clonarDe: activoId,
  });
}

/**
 * Cotización mínima insertada a mano en un catálogo dado. No pasa por
 * `createQuote` a propósito: aquí solo importa que exista el renglón que cuelga
 * del catálogo, no lo que cueste.
 */
async function quoteEn(priceListId: string, status: 'borrador' | 'formalizada', papelera = false) {
  const client = await prisma.client.create({ data: { nombre: `Cliente impacto ${randomUUID().slice(0, 6)}` } });
  createdClientIds.push(client.id);
  const eventType = await prisma.eventType.findFirstOrThrow();
  const quote = await prisma.quote.create({
    data: {
      clientId: client.id,
      eventTypeId: eventType.id,
      fechaEvento: new Date('2031-04-05'),
      invitados: 100,
      spaceIds: [],
      breakdown: {},
      total: 1000,
      rentaTotal: 1000,
      status,
      publicToken: randomUUID().replace(/-/g, ''),
      priceListId,
      ...(papelera ? { deletedAt: new Date() } : {}),
    },
  });
  createdQuoteIds.push(quote.id);
  return quote;
}

describe('impacto de editar un catálogo', () => {
  it('cuenta las cotizaciones vivas por estatus y excluye la papelera', async () => {
    const clon = await clonVacio('IMPACTO-PAPELERA', 2088);
    try {
      const antes = await impactoDeCatalogo(prisma, clon.id);
      expect(antes.total).toBe(0);

      await quoteEn(clon.id, 'borrador');
      await quoteEn(clon.id, 'borrador');
      // La papelera no cuenta: reeditar una cotización borrada no le importa a nadie.
      await quoteEn(clon.id, 'formalizada', true);

      const imp = await impactoDeCatalogo(prisma, clon.id);
      expect(imp.total).toBe(2);
      expect(imp.porEstatus).toEqual({ borrador: 2 });
      // La suma del desglose ES el total: si no cuadra, algún estatus se perdió.
      expect(Object.values(imp.porEstatus).reduce((s, n) => s + n, 0)).toBe(imp.total);
    } finally {
      await prisma.quote.deleteMany({ where: { priceListId: clon.id } });
      await borrarCatalogoDePrueba(prisma, clon.id);
    }
  });

  it('separa las comprometidas, que son las que de verdad duelen', async () => {
    const clon = await clonVacio('IMPACTO-COMPROMETIDAS', 2084);
    try {
      await quoteEn(clon.id, 'borrador');
      await quoteEn(clon.id, 'formalizada');

      const imp = await impactoDeCatalogo(prisma, clon.id);
      expect(imp.total).toBe(2);
      expect(imp.comprometidas).toBe(1); // solo la formalizada
      expect(imp.comprometidas).toBeLessThanOrEqual(imp.total);
      expect(ESTATUS_COMPROMETIDOS).toContain('liquidada');
    } finally {
      await prisma.quote.deleteMany({ where: { priceListId: clon.id } });
      await borrarCatalogoDePrueba(prisma, clon.id);
    }
  });

  it('el catálogo activo real reporta un desglose que cuadra con su total', async () => {
    const imp = await impactoDeCatalogo(prisma, activoId);
    expect(imp.total).toBeGreaterThanOrEqual(0);
    expect(Object.values(imp.porEstatus).reduce((s, n) => s + n, 0)).toBe(imp.total);
    expect(imp.comprometidas).toBeLessThanOrEqual(imp.total);
  });

  it('un catálogo recién clonado tiene impacto cero', async () => {
    const clon = await clonVacio('IMPACTO', 2090);
    try {
      const imp = await impactoDeCatalogo(prisma, clon.id);
      expect(imp.total).toBe(0);
      expect(imp.comprometidas).toBe(0);
    } finally {
      await borrarCatalogoDePrueba(prisma, clon.id);
    }
  });

  it('un catálogo inexistente da 404', async () => {
    await expect(impactoDeCatalogo(prisma, 'no-existe')).rejects.toMatchObject({ status: 404 });
  });
});

describe('bitácora del catálogo', () => {
  it('congela cotizacionesEnRiesgo al momento del cambio', async () => {
    const clon = await clonVacio('BITACORA-CONGELA', 2083);
    try {
      await quoteEn(clon.id, 'formalizada');

      await registrarCambioCatalogo(
        prisma,
        { priceListId: clon.id, tipo: 'renta', descripcion: 'Subió la renta del sábado', meta: { antes: 1, despues: 2 } },
        { id: adminId, role: 'admin' },
      );

      // Aparece una segunda cotización DESPUÉS del cambio: el renglón ya escrito
      // no se mueve, porque mide lo que había entonces y no lo que hay hoy.
      await quoteEn(clon.id, 'borrador');

      const bitacora = await listarBitacoraCatalogo(prisma, clon.id);
      expect(bitacora).toHaveLength(1);
      expect(bitacora[0]!.tipo).toBe('renta');
      expect(bitacora[0]!.cotizacionesEnRiesgo).toBe(1);
      expect(bitacora[0]!.actorId).toBe(adminId);
      // El impacto de HOY ya es otro; el renglón sigue diciendo 1.
      expect((await impactoDeCatalogo(prisma, clon.id)).total).toBe(2);
      expect(bitacora[0]!.meta).toMatchObject({
        antes: 1,
        despues: 2,
        impacto: { total: 1, comprometidas: 1 },
      });
    } finally {
      await prisma.quote.deleteMany({ where: { priceListId: clon.id } });
      await borrarCatalogoDePrueba(prisma, clon.id);
    }
  });

  it('NO traga sus errores: si la bitácora no se puede escribir, lanza', async () => {
    // `logActivity` hace `catch {}` a propósito y eso ya dejó un sellado de
    // facturas sin rastro. Aquí son precios: sin rastro, no hay cambio.
    await expect(
      registrarCambioCatalogo(
        prisma,
        { priceListId: 'no-existe', tipo: 'renta', descripcion: 'catálogo fantasma' },
        { id: adminId, role: 'admin' },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(await prisma.priceListAudit.count({ where: { priceListId: 'no-existe' } })).toBe(0);
  });
});
