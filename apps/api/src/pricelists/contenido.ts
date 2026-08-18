import type { PrismaClient } from '@hsa/database';
import { QuoteError } from '../quotes/service.js';

/**
 * Todo lo editable de UN catálogo, con los ids que necesita el editor.
 *
 * No sirve `GET /catalog?priceListId=…` para esto: ese endpoint devuelve el
 * `Catalog` del MOTOR, que aplana la renta a `{ spaceId, min, max, prices }`
 * **sin el id de `RentalPrice`**. Sin ese id no hay `PATCH …/rentas` posible.
 * Tampoco trae `tipo` (día vs. plano), que aquí es la columna que distingue los
 * 37 renglones, ni los brackets del paquete con su forma editable.
 *
 * Es una lectura de administración —requiere admin— y por eso trae los
 * servicios y paquetes tal cual están, incluidos los `activo: false`: el editor
 * tiene que poder volver a activar lo que dio de baja.
 */
export async function contenidoDeCatalogo(db: PrismaClient, priceListId: string) {
  const priceList = await db.priceList.findUnique({ where: { id: priceListId } });
  if (!priceList) throw new QuoteError(404, `El catálogo ${priceListId} no existe`);

  const [renta, servicios, paquetes, dj, eventTypes] = await Promise.all([
    db.rentalPrice.findMany({
      where: { priceListId },
      include: { space: { select: { nombre: true } } },
      // Por espacio y rango: es el orden en que se lee una tabla de precios, y
      // el editor no reordena nada.
      orderBy: [{ space: { nombre: 'asc' } }, { tipo: 'asc' }, { min: 'asc' }],
    }),
    db.addOn.findMany({ where: { priceListId }, orderBy: { nombre: 'asc' } }),
    db.foodPackage.findMany({
      where: { priceListId },
      include: { brackets: { orderBy: { min: 'asc' } } },
      orderBy: { nombre: 'asc' },
    }),
    db.djHoraExtraPrice.findMany({ where: { priceListId } }),
    // Los tipos de evento son globales, no del catálogo: hacen falta para
    // nombrar el paquete y el renglón del DJ, y para ofrecer los que todavía
    // no tienen precio de DJ (que es cómo se le pone uno).
    db.eventType.findMany({ orderBy: { nombre: 'asc' }, select: { id: true, nombre: true, slug: true } }),
  ]);

  return {
    priceList: {
      id: priceList.id,
      nombre: priceList.nombre,
      anio: priceList.anio,
      activa: priceList.activa,
      ivaRate: priceList.ivaRate,
      extraHourRate: priceList.extraHourRate,
      foodDiscountRate: priceList.foodDiscountRate,
      capillaSabado: priceList.capillaSabado,
    },
    renta: renta.map((r) => ({
      id: r.id,
      spaceId: r.spaceId,
      espacio: r.space.nombre,
      tipo: r.tipo,
      min: r.min,
      max: r.max,
      viernes: r.viernes,
      viernesEspecial: r.viernesEspecial,
      sabado: r.sabado,
      domAJue: r.domAJue,
    })),
    servicios: servicios.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      kind: s.kind,
      price: s.price,
      activo: s.activo,
    })),
    paquetes: paquetes.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      eventTypeId: p.eventTypeId,
      ivaIncluido: p.ivaIncluido,
      incluye: p.incluye,
      brackets: p.brackets.map((b) => ({
        min: b.min,
        max: b.max,
        pricePerPerson: b.pricePerPerson,
      })),
    })),
    dj: dj.map((d) => ({ eventTypeId: d.eventTypeId, price: d.price })),
    eventTypes,
  };
}
