import { prisma } from '../src/index.js';
import { applyCatalog2027 } from './data/catalog-2027.js';
import { applyTeamBuilding2027 } from './data/team-building-2027.js';

/**
 * Backfill IDEMPOTENTE de la Fase 7 (Team Building) para una base que ya tiene
 * catálogo 2027 sembrado. Agrega:
 *  - El tipo de evento "Team Building" (renta plana), vía applyCatalog2027.
 *  - Los espacios Los Balcones y Los Pajaritos.
 *  - La renta PLANA (RENTA 2027) en el catálogo activo, y las filas planas de
 *    Balcones/Pajaritos también en la renta por-día (para cualquier evento).
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
  const planas = await prisma.rentalPrice.count({ where: { tipo: 'plano', priceList: { activa: true } } });
  console.log(`Espacios activos: ${spaces.map((s) => s.nombre).join(', ')}`);
  console.log(`Filas de renta plana: ${planas}`);
  console.log('\nListo.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill fase 7 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
