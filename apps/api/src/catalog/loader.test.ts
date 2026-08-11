import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { computeQuote } from '@hsa/shared';
import { loadCatalog } from './loader.js';

const addOnsCreados: string[] = [];
afterAll(async () => {
  await prisma.addOn.deleteMany({ where: { id: { in: addOnsCreados } } });
});

describe('loadCatalog', () => {
  it('carga el catálogo seedeado (renta por-día + plana)', async () => {
    const catalog = await loadCatalog(prisma);
    // 15 base (Arcos 5, Campos 5, Cúpula 4, Capilla 1) + Balcones 2 + Pajaritos 1 = 18.
    expect(catalog.rentalPrices.length).toBe(18);
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
      data: { nombre: 'ZZZ Prueba inactivo', kind: 'porUnidad', price: 100, activo: false },
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
      data: { nombre: 'ZZZ Valet de prueba', kind: 'porUnidad', price: 100, activo: false },
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
