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
      addOns: [],
    });
    expect(r.rentaTotal).toBe(108500);
  });
});
