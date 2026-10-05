import { prisma } from '@hsa/database';
import { reclasificarConceptos } from '../payments/conceptos.js';

/**
 * Vuelve a etiquetar los pagos de todos los eventos con la regla vigente
 * (idempotente: solo escribe lo que cambia, y cada cambio queda en la bitácora
 * del evento, así que el BI lo ve en /cambios).
 *
 * Existe por el cambio a las etiquetas del BI (5-oct-2026): los pagos que ya
 * estaban guardados con `complemento` o con la regla anterior se ponen al día al
 * arrancar, sin que nadie tenga que tocarlos. Corre en cada arranque del
 * contenedor; en una base al día no hace nada.
 *
 * Uso: pnpm --filter @hsa/api exec tsx src/scripts/reclasificar-conceptos.ts
 */
async function main(): Promise<void> {
  const quotes = await prisma.quote.findMany({
    where: { deletedAt: null, payments: { some: {} } },
    select: { id: true, rentaTotal: true, fechaEvento: true, status: true, spaceIds: true, breakdown: true },
  });
  let eventos = 0;
  let pagos = 0;
  for (const q of quotes) {
    const { cambios } = await reclasificarConceptos(prisma, q);
    if (cambios.length > 0) {
      eventos++;
      pagos += cambios.length;
    }
  }
  console.log(
    pagos === 0
      ? 'Conceptos de pago al día.'
      : `Conceptos de pago reclasificados: ${pagos} pago(s) en ${eventos} evento(s).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Reclasificar conceptos falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
