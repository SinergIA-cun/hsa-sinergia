import type { PrismaClient } from '@hsa/database';
import { COLUMNAS_BASE } from '@hsa/shared';
import type { Actor } from '../quotes/service.js';
import { columnasDe, preciosDe } from '../catalog/loader.js';
import { guardarTablaRenta } from './tablaRenta.js';

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

/**
 * Cambia precios de renta de un catálogo de prueba por la vía real
 * (`guardarTablaRenta`): arma la tabla tal cual está y sobrescribe los precios
 * de los renglones indicados.
 */
export async function cambiarPreciosDePrueba(
  db: PrismaClient,
  priceListId: string,
  cambios: { id: string; precios: Record<string, number | null> }[],
  actor: Actor | null,
) {
  const [renglones, guardadas] = await Promise.all([
    db.rentalPrice.findMany({ where: { priceListId } }),
    columnasDe(db, priceListId),
  ]);
  const porId = new Map(cambios.map((c) => [c.id, c.precios]));
  return guardarTablaRenta(
    db,
    priceListId,
    {
      columnas: guardadas.length ? guardadas : [...COLUMNAS_BASE],
      renglones: renglones.map((r) => ({
        id: r.id,
        spaceId: r.spaceId,
        tipo: r.tipo,
        min: r.min,
        max: r.max,
        precios: { ...preciosDe(r.precios), ...(porId.get(r.id) ?? {}) },
      })),
    },
    actor,
  );
}
