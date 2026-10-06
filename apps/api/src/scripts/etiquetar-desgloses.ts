import { prisma } from '@hsa/database';
import { etiquetarDesgloses } from '../bi/etiquetarDesglose.js';

/**
 * Etiqueta los renglones de los desgloses guardados antes del 6-oct-2026 (qué es
 * cada uno: salón, paquete, servicio…) para el `desglose[]` del BI. No cambia
 * montos. Idempotente: corre en cada arranque y en una base al día no hace nada.
 *
 * Uso: pnpm --filter @hsa/api exec tsx src/scripts/etiquetar-desgloses.ts
 */
async function main(): Promise<void> {
  const { etiquetados, sinEmparejar } = await etiquetarDesgloses(prisma);
  console.log(etiquetados === 0 ? 'Desgloses al día.' : `Desgloses etiquetados: ${etiquetados}.`);
  if (sinEmparejar.length > 0) {
    console.log(`Sin emparejar (su desglose del BI sale como "otro"): ${sinEmparejar.join(', ')}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Etiquetar desgloses falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
