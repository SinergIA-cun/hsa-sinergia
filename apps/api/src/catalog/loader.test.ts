import { describe, it, expect } from 'vitest';
import { prisma } from '@hsa/database';
import { computeQuote } from '@hsa/shared';
import { loadCatalog } from './loader.js';

describe('loadCatalog', () => {
  it('carga el catálogo seedeado (4 espacios, 15 rentas)', async () => {
    const catalog = await loadCatalog(prisma);
    expect(catalog.rentalPrices.length).toBe(15);
    expect(catalog.foodPackages.length).toBeGreaterThanOrEqual(6);
    expect(catalog.ivaRate).toBe(0.16);
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
      foodPackageId: pkg!.id,
      addOns: [],
    });
    const alimento = r.lines.find((l) => l.concepto.startsWith('Alimentos'));
    expect(alimento?.monto).toBe(989 * 250); // bracket 201–300 de XV
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
