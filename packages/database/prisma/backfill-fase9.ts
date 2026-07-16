import { prisma } from '../src/index.js';
import { applyBanqueteros } from './data/banqueteros.js';

/**
 * Backfill IDEMPOTENTE de la Fase 9: siembra los banqueteros base si faltan.
 * El cliente agrega/edita más desde el panel de administración.
 *
 * Uso (en el contenedor de la API, con DATABASE_URL en el entorno):
 *   pnpm --filter @hsa/database exec tsx prisma/backfill-fase9.ts
 */
async function main(): Promise<void> {
  console.log('Sembrando banqueteros base…');
  await applyBanqueteros(prisma);
  const bs = await prisma.banquetero.findMany({ orderBy: { nombre: 'asc' } });
  console.log(`Banqueteros: ${bs.map((b) => b.nombre).join(', ')}`);
  console.log('\nListo.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill fase 9 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
