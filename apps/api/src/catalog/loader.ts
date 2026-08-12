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
 * Carga un catálogo completo desde Postgres y lo mapea al tipo `Catalog` que
 * consume el motor de `@hsa/shared`: renta (por día y plana), servicios,
 * paquetes de alimentos y los parámetros de precio.
 *
 * Resuelve el catálogo PEDIDO, o el activo si no se pide ninguno. Los parámetros
 * salen del catálogo y no de un singleton global: ese singleton era la última
 * fuente capaz de represiar TODA cotización con solo reeditarla.
 */
export async function loadCatalog(
  db: PrismaClient,
  opts: { priceListId?: string } = {},
): Promise<Catalog> {
  // NUNCA se cae al activo en silencio cuando se pidió uno concreto: eso
  // represiaría la cotización que lo fijó, que es el bug que este diseño mata.
  const priceList = opts.priceListId
    ? await db.priceList.findUnique({ where: { id: opts.priceListId } })
    : await db.priceList.findFirst({ where: { activa: true }, orderBy: { anio: 'desc' } });
  if (!priceList) {
    throw new Error(
      opts.priceListId ? `El catálogo ${opts.priceListId} no existe` : 'No hay catálogo activo',
    );
  }

  const [rentals, packages, addOns, eventTypes] = await Promise.all([
    db.rentalPrice.findMany({ where: { priceListId: priceList.id } }),
    db.foodPackage.findMany({ where: { priceListId: priceList.id }, include: { brackets: true } }),
    // SIN filtrar por `activo`: el catálogo tiene que RESOLVER todos los
    // add-ons, incluidos los dados de baja, porque las cotizaciones ya emitidas
    // los referencian por id y el motor lanza si no los encuentra. Quién se
    // sigue OFRECIENDO lo decide la interfaz con la bandera `activo`.
    db.addOn.findMany({ where: { priceListId: priceList.id } }),
    db.eventType.findMany({ select: { id: true, djHoraExtra: true, rentaPlana: true } }),
  ]);

  const djHoraExtraByEventType: Record<string, number> = {};
  const flatRentalEventTypeIds: string[] = [];
  for (const et of eventTypes) {
    if (et.djHoraExtra != null) djHoraExtraByEventType[et.id] = et.djHoraExtra;
    if (et.rentaPlana) flatRentalEventTypeIds.push(et.id);
  }

  return {
    ivaRate: priceList.ivaRate,
    extraHourRate: priceList.extraHourRate,
    foodDiscountRate: priceList.foodDiscountRate,
    capillaSabado: priceList.capillaSabado,
    djHoraExtraByEventType,
    // Un solo catálogo lleva las dos rentas; `tipo` en el renglón las distingue.
    rentalPrices: toRentalRows(rentals.filter((r) => r.tipo === 'dia')),
    rentalPricesFlat: toRentalRows(rentals.filter((r) => r.tipo === 'plano')),
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
      activo: a.activo,
    })),
  } satisfies Catalog;
}
