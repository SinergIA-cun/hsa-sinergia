import { prisma } from '../src/index.js';
import { applyCatalog2027, EVENT_TYPES_2027 } from './data/catalog-2027.js';

/**
 * Backfill IDEMPOTENTE de la Fase 6 (catálogo de eventos 2027) para una base
 * que YA tiene catálogo sembrado (producción). Agrega los tipos de evento
 * nuevos (XV, Cumpleaños, Fin de año, Graduación), amplía Empresarial a 7
 * paquetes, actualiza Bautizo a precios 2027 y renombra el DJ a "DJ Hora extra".
 *
 * NO toca Team Building ni la capilla (llegan en fases posteriores).
 *
 * Uso (en el contenedor de la API, con DATABASE_URL en el entorno):
 *   pnpm --filter @hsa/database exec tsx prisma/backfill-fase6.ts
 */
async function main(): Promise<void> {
  console.log('Aplicando catálogo de eventos 2027…');
  await applyCatalog2027(prisma);

  for (const et of EVENT_TYPES_2027) {
    const type = await prisma.eventType.findUnique({ where: { slug: et.slug } });
    const pkgs = type
      ? await prisma.foodPackage.count({ where: { eventTypeId: type.id } })
      : 0;
    console.log(`· ${et.nombre} (${et.slug}): ${pkgs} paquete(s) de alimentos`);
  }

  const total = await prisma.eventType.count();
  console.log(`\nListo. Tipos de evento en catálogo: ${total}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill fase 6 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
