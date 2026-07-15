import type { PrismaClient } from '@hsa/database';
import type { Catalog, RentalPriceRow } from '@hsa/shared';

/** Mapea filas de RentalPrice de Prisma al shape del motor. */
function toRentalRows(
  rows: { spaceId: string; min: number; max: number | null; viernes: number; viernesEspecial: number; sabado: number; domAJue: number }[],
): RentalPriceRow[] {
  return rows.map((r) => ({
    spaceId: r.spaceId,
    min: r.min,
    max: r.max,
    prices: { viernes: r.viernes, viernesEspecial: r.viernesEspecial, sabado: r.sabado, domAJue: r.domAJue },
  }));
}

/**
 * Carga el catálogo desde Postgres y lo mapea al tipo `Catalog` que consume el
 * motor de `@hsa/shared`. Usa la lista de precios activa (o la del año dado).
 */
export async function loadCatalog(
  db: PrismaClient,
  opts: { anio?: number } = {},
): Promise<Catalog> {
  const config = await db.pricingConfig.findUnique({ where: { id: 'default' } });
  if (!config) throw new Error('Falta PricingConfig (id=default)');

  const priceList = opts.anio
    ? await db.priceList.findFirst({ where: { anio: opts.anio, tipo: 'dia' } })
    : await db.priceList.findFirst({ where: { activa: true, tipo: 'dia' }, orderBy: { anio: 'desc' } });
  if (!priceList) throw new Error('No hay lista de precios activa');

  // Lista PLANA (Team Building): opcional, puede no existir aún.
  const flatList = await db.priceList.findFirst({
    where: { tipo: 'plano', ...(opts.anio ? { anio: opts.anio } : {}) },
    orderBy: { anio: 'desc' },
  });

  const [rentals, flatRentals, packages, addOns, eventTypes] = await Promise.all([
    db.rentalPrice.findMany({ where: { priceListId: priceList.id } }),
    flatList ? db.rentalPrice.findMany({ where: { priceListId: flatList.id } }) : Promise.resolve([]),
    db.foodPackage.findMany({ include: { brackets: true } }),
    db.addOn.findMany({ where: { activo: true } }),
    db.eventType.findMany({ select: { id: true, djHoraExtra: true, rentaPlana: true } }),
  ]);

  const djHoraExtraByEventType: Record<string, number> = {};
  const flatRentalEventTypeIds: string[] = [];
  for (const et of eventTypes) {
    if (et.djHoraExtra != null) djHoraExtraByEventType[et.id] = et.djHoraExtra;
    if (et.rentaPlana) flatRentalEventTypeIds.push(et.id);
  }

  return {
    ivaRate: config.ivaRate,
    extraHourRate: config.extraHourRate,
    foodDiscountRate: config.foodDiscountRate,
    capillaSabado: config.capillaSabado,
    djHoraExtraByEventType,
    rentalPrices: toRentalRows(rentals),
    rentalPricesFlat: toRentalRows(flatRentals),
    flatRentalEventTypeIds,
    foodPackages: packages.map((p) => ({
      id: p.id,
      eventTypeId: p.eventTypeId,
      name: p.nombre,
      ivaIncluded: p.ivaIncluido,
      brackets: p.brackets.map((b) => ({
        packageId: b.packageId,
        min: b.min,
        max: b.max,
        pricePerPerson: b.pricePerPerson,
      })),
    })),
    addOns: addOns.map((a) => ({
      id: a.id,
      name: a.nombre,
      kind: a.kind,
      price: a.price,
    })),
  } satisfies Catalog;
}
