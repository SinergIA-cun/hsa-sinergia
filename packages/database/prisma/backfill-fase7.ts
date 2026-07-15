import { prisma } from '../src/index.js';
import { applyCatalog2027 } from './data/catalog-2027.js';
import { applyTeamBuilding2027 } from './data/team-building-2027.js';

/**
 * Backfill IDEMPOTENTE de la Fase 7 (Team Building) para una base que ya tiene
 * catálogo 2027 sembrado. Agrega:
 *  - El tipo de evento "Team Building" (renta plana), vía applyCatalog2027.
 *  - Los espacios Los Balcones y Los Pajaritos.
 *  - La lista de precios PLANA (RENTA 2027) y las filas planas de Balcones/Pajaritos
 *    en la lista por-día (disponibles para cualquier evento).
 *
 * Uso (en el contenedor de la API, con DATABASE_URL en el entorno):
 *   pnpm --filter @hsa/database exec tsx prisma/backfill-fase7.ts
 */
async function main(): Promise<void> {
  console.log('Aplicando catálogo 2027 (asegura Team Building)…');
  await applyCatalog2027(prisma);

  console.log('Aplicando renta plana + espacios de Team Building…');
  await applyTeamBuilding2027(prisma);

  const spaces = await prisma.space.findMany({ where: { activo: true }, select: { nombre: true } });
  const flat = await prisma.priceList.findFirst({ where: { tipo: 'plano' }, include: { _count: { select: { rentalPrices: true } } } });
  console.log(`Espacios activos: ${spaces.map((s) => s.nombre).join(', ')}`);
  console.log(`Filas de renta plana: ${flat?._count.rentalPrices ?? 0}`);
  console.log('\nListo.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill fase 7 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
