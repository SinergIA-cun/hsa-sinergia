import { prisma } from '../src/index.js';
import { applyPaymentRules } from './data/payment-rules.js';

/**
 * Backfill IDEMPOTENTE de la Fase 8: garantiza las reglas de pago de los
 * espacios principales (Cúpula/Arcos/Campos). Sin ellas el estado de cuenta
 * queda en "plan pendiente", el auto-avance de estatus no dispara y no hay
 * alertas de finiquito. El plan de pagos se mide sobre la RENTA.
 *
 * Uso (en el contenedor de la API, con DATABASE_URL en el entorno):
 *   pnpm --filter @hsa/database exec tsx prisma/backfill-fase8.ts
 */
async function main(): Promise<void> {
  console.log('Garantizando reglas de pago por espacio…');
  await applyPaymentRules(prisma);

  const reglas = await prisma.spacePaymentRule.findMany({ include: { space: { select: { nombre: true } } } });
  for (const r of reglas) {
    console.log(`  ${r.space.nombre.padEnd(24)} anticipo ${r.anticipo}, complemento ${Math.round(r.complementoPct * 100)}%`);
  }
  console.log('\nListo.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill fase 8 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
