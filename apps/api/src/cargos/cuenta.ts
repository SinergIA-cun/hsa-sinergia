import type { PrismaClient } from '@hsa/database';
import { PRODUCTOS_CARGO, PRODUCTO_INFO, precioHoraExtra, rentaBaseDeDesglose, saldoDeCargos } from '@hsa/shared';

/*
 * Las LECTURAS de la cuenta del punto de venta, aparte de las escrituras de
 * `service.ts`: `getQuote` las necesita y `service.ts` importa de
 * `quotes/service.ts`, así que meterlas allá haría un ciclo de módulos.
 */

/**
 * Lo que se ofrece en el punto de venta de ESTE evento, con el precio sugerido.
 *
 * La hora extra sale de la renta firmada (la misma regla que el cotizador:
 * `extraHourRate` del catálogo del evento × su renta efectiva). El DJ, del precio
 * por tipo de evento de su catálogo; si ese tipo de evento no tiene DJ extra, no
 * se ofrece. Lo demás no tiene tarifa: se teclea.
 */
export async function productosDelEvento(
  db: PrismaClient,
  quote: { priceListId: string; eventTypeId: string; breakdown: unknown },
) {
  const [lista, dj] = await Promise.all([
    db.priceList.findUnique({ where: { id: quote.priceListId }, select: { extraHourRate: true } }),
    db.djHoraExtraPrice.findFirst({
      where: { priceListId: quote.priceListId, eventTypeId: quote.eventTypeId },
      select: { price: true },
    }),
  ]);
  const hora = precioHoraExtra(rentaBaseDeDesglose(quote.breakdown), lista?.extraHourRate ?? 0.05);
  return PRODUCTOS_CARGO.filter((p) => p !== 'djHoraExtra' || dj != null).map((p) => {
    const info = PRODUCTO_INFO[p];
    const precioSugerido =
      info.precio === 'horaDeRenta' ? hora : info.precio === 'djDelCatalogo' ? (dj?.price ?? null) : null;
    return { ...info, precioSugerido };
  });
}

/** La cuenta completa: renglones, sus pagos y el saldo. */
export async function cuentaDelEvento(db: PrismaClient, quoteId: string) {
  const [cargos, pagos] = await Promise.all([
    db.cargoEvento.findMany({
      where: { quoteId },
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
      include: { registradoBy: { select: { nombre: true } } },
    }),
    db.payment.findMany({ where: { quoteId, destino: 'cargos' }, orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  return { cargos, pagos, ...saldoDeCargos(cargos, pagos) };
}

