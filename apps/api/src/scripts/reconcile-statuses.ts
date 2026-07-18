import { prisma } from '@hsa/database';
import { reconcileStatuses } from '../quotes/service.js';

/**
 * Pone al día el estatus de las cotizaciones contra lo YA pagado (idempotente).
 *
 * El auto-avance solo dispara al registrar un pago nuevo, así que las
 * cotizaciones que pagaron cuando aún no existían las reglas de pago se
 * quedaron atrás (p. ej. pagó el anticipo y sigue en "borrador"). Esto las
 * avanza al hito que ya cubrieron. Nunca baja un estatus.
 *
 * Uso (en el contenedor de la API, con DATABASE_URL en el entorno):
 *   pnpm --filter @hsa/api exec tsx src/scripts/reconcile-statuses.ts
 */
async function main(): Promise<void> {
  console.log('Reconciliando estatus contra pagos registrados…');
  const cambios = await reconcileStatuses(prisma);

  if (cambios.length === 0) {
    console.log('  Todo al día: ningún estatus quedó atrasado.');
  } else {
    for (const c of cambios) {
      console.log(`  ${c.cliente.padEnd(26)} ${c.de} → ${c.a}  (pagado ${c.pagado})`);
    }
    console.log(`\n${cambios.length} cotización(es) puestas al día.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Reconciliación de estatus falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
