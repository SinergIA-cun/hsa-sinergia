import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@hsa/database';
import { computeQuote } from '@hsa/shared';
import { loadCatalog } from './loader.js';

const addOnsCreados: string[] = [];

// Los catálogos de prueba se nombran con el prefijo PRUEBA- y se barren al final
// pase lo que pase: un catálogo huérfano de una corrida que abortó rompería el
// `nombre @unique` de la siguiente.
const PREFIJO_PRUEBA = 'PRUEBA-';
beforeAll(async () => {
  await prisma.priceList.deleteMany({ where: { nombre: { startsWith: PREFIJO_PRUEBA } } });
});
afterAll(async () => {
  await prisma.addOn.deleteMany({ where: { id: { in: addOnsCreados } } });
  await prisma.priceList.deleteMany({ where: { nombre: { startsWith: PREFIJO_PRUEBA } } });
});

/** El catálogo activo, que es contra el que corren estas pruebas. */
async function catalogoActivo() {
  return prisma.priceList.findFirstOrThrow({ where: { activa: true }, orderBy: { anio: 'desc' } });
}

describe('loadCatalog', () => {
  it('carga el catálogo seedeado (renta por-día + plana)', async () => {
    const catalog = await loadCatalog(prisma);
    // 14 base (Arcos 5, Campos 5, Cúpula 4) + Balcones 2 + Pajaritos 1 = 17.
    // La Capilla ya no es un salón rentable (backfill fase13): es la casilla con
    // tarifa de sábado, así que su renglón de renta desapareció.
    expect(catalog.rentalPrices.length).toBe(17);
    expect(catalog.foodPackages.length).toBeGreaterThanOrEqual(6);
    expect(catalog.ivaRate).toBe(0.16);
  });

  it('carga la renta plana (Team Building) y su tipo de evento', async () => {
    const catalog = await loadCatalog(prisma);
    // Cúpula 7 + Arcos 5 + Campos 5 + Balcones 2 + Pajaritos 1 = 20.
    expect(catalog.rentalPricesFlat.length).toBe(20);
    const tb = await prisma.eventType.findUnique({ where: { slug: 'team-building' } });
    expect(tb).not.toBeNull();
    expect(catalog.flatRentalEventTypeIds).toContain(tb!.id);
  });

  it('Team Building cotiza con renta plana (Arcos 250 = 50,000, igual sábado que jueves)', async () => {
    const catalog = await loadCatalog(prisma);
    const arcos = await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } });
    const tb = await prisma.eventType.findUnique({ where: { slug: 'team-building' } });
    const sel = {
      invitados: 250,
      spaceIds: [arcos!.id],
      horasExtra: 0,
      usaCapilla: false,
      usaDjHoraExtra: false,
      eventTypeId: tb!.id,
      addOns: [],
    };
    const sab = computeQuote(catalog, { ...sel, fecha: '2027-05-08' });
    const jue = computeQuote(catalog, { ...sel, fecha: '2027-05-06' });
    expect(sab.rentaTotal).toBe(50000);
    expect(jue.rentaTotal).toBe(50000);
  });

  it('computeQuote sobre el catálogo real da el precio de folleto (Arcos 250 sábado = 108,500)', async () => {
    const catalog = await loadCatalog(prisma);
    const arcos = await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } });
    const r = computeQuote(catalog, {
      fecha: '2027-05-08',
      invitados: 250,
      spaceIds: [arcos!.id],
      horasExtra: 0,
      usaCapilla: false,
      usaDjHoraExtra: false,
      addOns: [],
    });
    expect(r.rentaTotal).toBe(108500);
  });

  it('catálogo 2027: XV existe y su alimento cotiza al precio de folleto (250 pax = $989/pax)', async () => {
    const catalog = await loadCatalog(prisma);
    const xv = await prisma.eventType.findUnique({ where: { slug: 'xv' } });
    expect(xv).not.toBeNull();
    const pkg = catalog.foodPackages.find((p) => p.eventTypeId === xv!.id);
    expect(pkg?.name).toBe('Servicio de Alimentos');

    const arcos = await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } });
    const r = computeQuote(catalog, {
      fecha: '2027-05-08',
      invitados: 250,
      spaceIds: [arcos!.id],
      horasExtra: 0,
      usaCapilla: false,
      usaDjHoraExtra: false,
      foodPackageId: pkg!.id,
      addOns: [],
    });
    const alimento = r.lines.find((l) => l.concepto.startsWith('Alimentos'));
    expect(alimento?.monto).toBe(989 * 250); // bracket 201–300 de XV
  });

  // El catálogo separa "resolver" de "ofrecer": trae TODOS los add-ons y marca
  // con `activo` cuáles se siguen ofreciendo. Sin esto, dar de baja un add-on
  // (p. ej. el valet, backfill fase12) dejaba irrecalculable toda cotización
  // histórica que lo referenciara.
  it('el catálogo RESUELVE los add-ons desactivados y los marca activo=false', async () => {
    const inactivo = await prisma.addOn.create({
      data: { nombre: 'ZZZ Prueba inactivo', kind: 'porUnidad', price: 100, activo: false, priceListId: (await catalogoActivo()).id },
    });
    addOnsCreados.push(inactivo.id);

    const catalog = await loadCatalog(prisma);
    const cargado = catalog.addOns.find((a) => a.id === inactivo.id);
    expect(cargado).toBeDefined();
    expect(cargado!.activo).toBe(false);
    // Y los que sí se ofrecen quedan marcados como tal.
    expect(catalog.addOns.some((a) => a.activo)).toBe(true);
  });

  it('una cotización que referencia un add-on desactivado se puede recalcular', async () => {
    const inactivo = await prisma.addOn.create({
      data: { nombre: 'ZZZ Valet de prueba', kind: 'porUnidad', price: 100, activo: false, priceListId: (await catalogoActivo()).id },
    });
    addOnsCreados.push(inactivo.id);

    const catalog = await loadCatalog(prisma);
    const arcos = await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } });
    const r = computeQuote(catalog, {
      fecha: '2027-05-08',
      invitados: 250,
      spaceIds: [arcos!.id],
      horasExtra: 0,
      usaCapilla: false,
      usaDjHoraExtra: false,
      addOns: [{ addOnId: inactivo.id, cantidad: 4 }],
    });
    // Se sigue cobrando: el precio de una cotización emitida no se mueve solo.
    expect(r.lines.find((l) => l.concepto === 'ZZZ Valet de prueba')?.monto).toBe(400);
  });

  it('un add-on con id inexistente (no solo inactivo) sigue lanzando error', async () => {
    const catalog = await loadCatalog(prisma);
    const arcos = await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } });
    expect(() =>
      computeQuote(catalog, {
        fecha: '2027-05-08',
        invitados: 250,
        spaceIds: [arcos!.id],
        horasExtra: 0,
        usaCapilla: false,
        usaDjHoraExtra: false,
        addOns: [{ addOnId: 'basura-que-nunca-existio', cantidad: 1 }],
      }),
    ).toThrow(/no existe/);
  });

  it('catálogo 2027: Empresarial (y Fin de año) tienen los 7 paquetes del folleto', async () => {
    const emp = await prisma.eventType.findUnique({ where: { slug: 'empresarial' } });
    const fin = await prisma.eventType.findUnique({ where: { slug: 'fin-de-ano' } });
    const empCount = await prisma.foodPackage.count({ where: { eventTypeId: emp!.id } });
    const finCount = await prisma.foodPackage.count({ where: { eventTypeId: fin!.id } });
    expect(empCount).toBe(7);
    expect(finCount).toBe(7);
  });
});

describe('loadCatalog por catálogo', () => {
  it('resuelve el catálogo por id y toma sus parámetros, no un singleton global', async () => {
    const otro = await prisma.priceList.create({
      data: { nombre: 'PRUEBA-2099', anio: 2099, ivaRate: 0.08, extraHourRate: 0.1, capillaSabado: 9999 },
    });
    const cat = await loadCatalog(prisma, { priceListId: otro.id });
    expect(cat.ivaRate).toBe(0.08);
    expect(cat.extraHourRate).toBe(0.1);
    expect(cat.capillaSabado).toBe(9999);
    await prisma.priceList.delete({ where: { id: otro.id } });
  });

  it('sin priceListId toma el catálogo activo', async () => {
    const cat = await loadCatalog(prisma);
    expect(cat.rentalPrices.length).toBeGreaterThan(0);
  });

  it('un catálogo inexistente lanza, no cae al activo en silencio', async () => {
    await expect(loadCatalog(prisma, { priceListId: 'no-existe' })).rejects.toThrow(/no existe|not found/i);
  });

  it('la renta plana vive en el mismo catálogo, distinguida por tipo', async () => {
    const cat = await loadCatalog(prisma);
    expect(cat.rentalPricesFlat.length).toBeGreaterThan(0);
  });

  it('los servicios y paquetes son los del catálogo pedido', async () => {
    const cat = await loadCatalog(prisma);
    expect(cat.addOns.length).toBeGreaterThan(0);
    expect(cat.foodPackages.length).toBeGreaterThan(0);
  });

  // Un catálogo recién clonado no comparte NADA con el de origen: si el loader
  // cayera a "todos los add-ons" o "todos los paquetes", clonar no serviría de
  // nada y editar el clon represiaría lo cotizado con el original.
  it('un catálogo vacío no hereda los servicios ni los paquetes del activo', async () => {
    const vacio = await prisma.priceList.create({ data: { nombre: 'PRUEBA-VACIO', anio: 2098 } });
    const cat = await loadCatalog(prisma, { priceListId: vacio.id });
    expect(cat.addOns).toHaveLength(0);
    expect(cat.foodPackages).toHaveLength(0);
    expect(cat.rentalPrices).toHaveLength(0);
    await prisma.priceList.delete({ where: { id: vacio.id } });
  });
});
