import type { PrismaClient } from '@hsa/database';

/**
 * Borra un catálogo de prueba con TODO lo que cuelga de él.
 *
 * Los FK a `PriceList` son RESTRICT, así que el orden no es cosmético: borrar la
 * `PriceList` antes de sus hijos falla, y borrar `FoodPackage` antes de sus
 * brackets también. Vive aquí y no copiado en cada suite porque el orden es
 * exactamente la parte fácil de equivocar, y dos copias divergen al primer
 * modelo nuevo que cuelgue del catálogo.
 *
 * NO borra las cotizaciones: una cotización casada a un catálogo es evidencia, y
 * si quedó alguna viva el RESTRICT debe gritar en vez de que este helper la
 * arrastre en silencio.
 */
export async function borrarCatalogoDePrueba(db: PrismaClient, priceListId: string): Promise<void> {
  await db.djHoraExtraPrice.deleteMany({ where: { priceListId } });
  await db.rentalPrice.deleteMany({ where: { priceListId } });
  await db.foodPackagePrice.deleteMany({ where: { package: { priceListId } } });
  await db.foodPackage.deleteMany({ where: { priceListId } });
  await db.addOn.deleteMany({ where: { priceListId } });
  await db.priceListAudit.deleteMany({ where: { priceListId } });
  await db.priceList.delete({ where: { id: priceListId } });
}
