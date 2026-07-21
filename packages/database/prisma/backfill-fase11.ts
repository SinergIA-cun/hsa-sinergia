import { prisma } from '../src/index.js';
import { applyPersonal } from './data/personal.js';

/**
 * Backfill IDEMPOTENTE de la Fase 11: siembra el personal HSA base y una
 * cuadrilla de ejemplo si faltan. El cliente agrega/edita empleados y arma sus
 * cuadrillas desde el panel de administración.
 *
 * Uso (en el contenedor de la API, con DATABASE_URL en el entorno):
 *   pnpm --filter @hsa/database exec tsx prisma/backfill-fase11.ts
 */
async function main(): Promise<void> {
  console.log('Sembrando personal HSA + cuadrilla de ejemplo…');
  await applyPersonal(prisma);
  const [emps, cuadrillas] = await Promise.all([
    prisma.empleado.count(),
    prisma.cuadrilla.count(),
  ]);
  console.log(`Empleados: ${emps} · Cuadrillas: ${cuadrillas}`);
  console.log('\nListo.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill fase 11 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
