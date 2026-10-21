import type { Prisma, PrismaClient } from '@hsa/database';
import type { Catalog, ColumnaRenta, RentalPriceRow } from '@hsa/shared';

/** Una tabla de renta del catálogo, sin sus renglones. */
export interface TablaRentaDef {
  clave: string;
  nombre: string;
  eventTypeIds: string[];
}

/**
 * Lee `RentalPrice.precios` (JSON) como mapa clave → pesos | null. Lo que no sea
 * un número entero se lee como "sin precio": un JSON torcido no debe cobrar.
 */
export function preciosDe(json: Prisma.JsonValue): Record<string, number | null> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(json)) out[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  return out;
}

/** Las columnas de renta de un catálogo, en su orden; vacío = las de siempre. */
export async function columnasDe(db: Pick<PrismaClient, 'columnaRenta'>, priceListId: string): Promise<ColumnaRenta[]> {
  const cols = await db.columnaRenta.findMany({ where: { priceListId }, orderBy: { orden: 'asc' } });
  return cols.map((c) => ({ clave: c.clave, nombre: c.nombre, dias: c.dias, meses: c.meses, respaldo: c.respaldo }));
}

/**
 * Las tablas de renta de un catálogo, en su orden (21-oct-2026). Un catálogo sin
 * tablas guardadas usa las dos de siempre: "Renta" para los tipos de evento
 * normales y, si tiene renglones planos, "Renta plana (Team Building)" para los
 * de `rentaPlana`. Es lo mismo que cobraba el motor antes de que existieran.
 */
export async function tablasDe(
  db: Pick<PrismaClient, 'tablaRenta' | 'eventType' | 'rentalPrice'>,
  priceListId: string,
): Promise<TablaRentaDef[]> {
  const guardadas = await db.tablaRenta.findMany({ where: { priceListId }, orderBy: { orden: 'asc' } });
  if (guardadas.length) return guardadas.map((t) => ({ clave: t.clave, nombre: t.nombre, eventTypeIds: t.eventTypeIds }));
  const [tipos, planos] = await Promise.all([
    db.eventType.findMany({ orderBy: { nombre: 'asc' }, select: { id: true, rentaPlana: true } }),
    db.rentalPrice.count({ where: { priceListId, tipo: 'plano' } }),
  ]);
  return [
    { clave: 'dia', nombre: 'Renta', eventTypeIds: tipos.filter((t) => !t.rentaPlana).map((t) => t.id) },
    ...(planos > 0
      ? [{ clave: 'plano', nombre: 'Renta plana (Team Building)', eventTypeIds: tipos.filter((t) => t.rentaPlana).map((t) => t.id) }]
      : []),
  ];
}

/** Mapea filas de RentalPrice de Prisma al shape del motor. */
function toRentalRows(
  rows: { spaceId: string; min: number; max: number | null; precios: Prisma.JsonValue }[],
): RentalPriceRow[] {
  return rows.map((r) => ({ spaceId: r.spaceId, min: r.min, max: r.max, prices: preciosDe(r.precios) }));
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

  const [rentals, columnasRenta, tablas, packages, addOns, djPrices, eventTypes, spaces] = await Promise.all([
    db.rentalPrice.findMany({ where: { priceListId: priceList.id } }),
    columnasDe(db, priceList.id),
    tablasDe(db, priceList.id),
    db.foodPackage.findMany({ where: { priceListId: priceList.id }, include: { brackets: true } }),
    // SIN filtrar por `activo`: el catálogo tiene que RESOLVER todos los
    // add-ons, incluidos los dados de baja, porque las cotizaciones ya emitidas
    // los referencian por id y el motor lanza si no los encuentra. Quién se
    // sigue OFRECIENDO lo decide la interfaz con la bandera `activo`.
    db.addOn.findMany({ where: { priceListId: priceList.id } }),
    // El DJ por hora extra sale del CATÁLOGO, no de `EventType`: ahí era un
    // precio global que clonar no subía y editar represiaba todo lo reeditado.
    db.djHoraExtraPrice.findMany({ where: { priceListId: priceList.id } }),
    // `EventType` sigue haciendo falta, pero solo por `rentaPlana`.
    db.eventType.findMany({ select: { id: true, rentaPlana: true } }),
    // Para que el motor diga "Arcos no se ofrece en sábado" y no un id.
    db.space.findMany({ select: { id: true, nombre: true } }),
  ]);

  // Un tipo de evento SIN renglón no ofrece el servicio (hoy: graduación, renta
  // y team building). El motor ya lo entiende así: si el mapa no lo trae, no
  // cobra el DJ aunque la casilla venga marcada.
  const djHoraExtraByEventType: Record<string, number> = {};
  for (const d of djPrices) djHoraExtraByEventType[d.eventTypeId] = d.price;

  const flatRentalEventTypeIds: string[] = [];
  for (const et of eventTypes) {
    if (et.rentaPlana) flatRentalEventTypeIds.push(et.id);
  }

  return {
    ivaRate: priceList.ivaRate,
    extraHourRate: priceList.extraHourRate,
    foodDiscountRate: priceList.foodDiscountRate,
    capillaSabado: priceList.capillaSabado,
    toleranciaExtras: priceList.toleranciaExtras,
    djHoraExtraByEventType,
    // Un solo catálogo lleva las dos rentas; `tipo` en el renglón las distingue.
    rentalPrices: toRentalRows(rentals.filter((r) => r.tipo === 'dia')),
    rentalPricesFlat: toRentalRows(rentals.filter((r) => r.tipo === 'plano')),
    flatRentalEventTypeIds,
    // Lo que de verdad lee el motor: cada tipo de evento con su tabla.
    tablasRenta: tablas.map((t) => ({ ...t, rows: toRentalRows(rentals.filter((r) => r.tipo === t.clave)) })),
    foodPackages: packages.map((p) => ({
      id: p.id,
      eventTypeId: p.eventTypeId,
      name: p.nombre,
      ivaIncluded: p.ivaIncluido,
      comisionPct: p.comisionPct,
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
      proveedorId: a.proveedorId,
      comisionPct: a.comisionPct,
      cobra: a.cobra,
    })),
    spaceNames: Object.fromEntries(spaces.map((s) => [s.id, s.nombre])),
    // Vacío = las cuatro de siempre (el motor usa `COLUMNAS_BASE`).
    ...(columnasRenta.length ? { columnasRenta } : {}),
  } satisfies Catalog;
}
