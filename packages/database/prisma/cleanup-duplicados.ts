/**
 * Limpieza puntual: elimina espacios y listas de precios DUPLICADOS que quedaron
 * por correr el seed más de una vez (antes de hacerlo idempotente).
 *
 * Estrategia: conserva la lista de precios MÁS ANTIGUA (la del primer seed, que sí
 * completó con eventos/paquetes) y los espacios ligados a ella; borra el resto.
 * No toca cotizaciones, clientes, tipos de evento, paquetes ni add-ons.
 *
 * Correr UNA vez en la consola del servicio api:
 *   pnpm --filter @hsa/database exec tsx prisma/cleanup-duplicados.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const lists = await prisma.priceList.findMany({ orderBy: { createdAt: 'asc' } });
  if (lists.length <= 1) {
    console.log(`Solo hay ${lists.length} lista(s) de precios — nada que limpiar.`);
  }
  const keep = lists[0];
  if (!keep) {
    console.log('No hay listas de precios. Corre el seed.');
    return;
  }
  const dropListIds = lists.slice(1).map((l) => l.id);

  // Espacios que SÍ tienen precios en la lista que conservamos.
  const keepPrices = await prisma.rentalPrice.findMany({ where: { priceListId: keep.id } });
  const keepSpaceIds = new Set(keepPrices.map((p) => p.spaceId));

  const allSpaces = await prisma.space.findMany();
  const dropSpaceIds = allSpaces.filter((s) => !keepSpaceIds.has(s.id)).map((s) => s.id);

  // Borrar precios de las listas descartadas y de los espacios huérfanos.
  const delPricesByList = dropListIds.length
    ? await prisma.rentalPrice.deleteMany({ where: { priceListId: { in: dropListIds } } })
    : { count: 0 };
  const delPricesBySpace = dropSpaceIds.length
    ? await prisma.rentalPrice.deleteMany({ where: { spaceId: { in: dropSpaceIds } } })
    : { count: 0 };
  const delSpaces = dropSpaceIds.length
    ? await prisma.space.deleteMany({ where: { id: { in: dropSpaceIds } } })
    : { count: 0 };
  const delLists = dropListIds.length
    ? await prisma.priceList.deleteMany({ where: { id: { in: dropListIds } } })
    : { count: 0 };

  console.log('Limpieza completada:');
  console.log(`  Lista conservada: ${keep.id} (año ${keep.anio})`);
  console.log(`  Espacios eliminados: ${delSpaces.count}`);
  console.log(`  Precios de renta eliminados: ${delPricesByList.count + delPricesBySpace.count}`);
  console.log(`  Listas de precios eliminadas: ${delLists.count}`);
  console.log(`  Espacios restantes: ${await prisma.space.count()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
