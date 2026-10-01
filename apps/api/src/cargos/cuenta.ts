import type { PrismaClient } from '@hsa/database';
import {
  PRODUCTOS_CARGO,
  PRODUCTO_INFO,
  porPersonaDelNivel,
  precioHoraExtra,
  rentaBaseDeDesglose,
  saldoDeCargos,
} from '@hsa/shared';
import { loadCatalog } from '../catalog/loader.js';

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
 * se ofrece. Los invitados extra, al precio por persona del NIVEL del evento
 * (renta: precio del nivel ÷ su tope; alimentos: el de su paquete, con IVA), que
 * es como el dueño cobra a la gente que llega de más. Lo demás se teclea.
 */
export async function productosDelEvento(
  db: PrismaClient,
  quote: {
    priceListId: string;
    eventTypeId: string;
    breakdown: unknown;
    fechaEvento: Date;
    invitados: number;
    spaceIds: string[];
    foodPackageId: string | null;
  },
) {
  const [lista, dj] = await Promise.all([
    db.priceList.findUnique({ where: { id: quote.priceListId }, select: { extraHourRate: true } }),
    db.djHoraExtraPrice.findFirst({
      where: { priceListId: quote.priceListId, eventTypeId: quote.eventTypeId },
      select: { price: true },
    }),
  ]);
  const hora = precioHoraExtra(rentaBaseDeDesglose(quote.breakdown), lista?.extraHourRate ?? 0.05);
  // Si el catálogo no alcanza para calcularlo (un salón sin rango para esos
  // invitados, un evento importado con salón fuera de catálogo), no se sugiere:
  // se teclea, como cualquier producto sin tarifa.
  let porPersona: { renta: number | null; alimentos: number | null } = { renta: null, alimentos: null };
  try {
    porPersona = porPersonaDelNivel(await loadCatalog(db, { priceListId: quote.priceListId }), {
      fecha: quote.fechaEvento.toISOString().slice(0, 10),
      invitados: quote.invitados,
      spaceIds: quote.spaceIds,
      eventTypeId: quote.eventTypeId,
      foodPackageId: quote.foodPackageId ?? undefined,
      horasExtra: 0,
      usaCapilla: false,
      usaDjHoraExtra: false,
      addOns: [],
      extras: [],
    });
  } catch {
    // ver arriba: sin sugerencia
  }
  return PRODUCTOS_CARGO.filter(
    (p) =>
      (p !== 'djHoraExtra' || dj != null) &&
      // Los alimentos de los invitados extra solo si el evento lleva paquete.
      (p !== 'invitadoExtraAlimentos' || porPersona.alimentos != null),
  ).map((p) => {
    const info = PRODUCTO_INFO[p];
    const precioSugerido =
      info.precio === 'horaDeRenta'
        ? hora
        : info.precio === 'djDelCatalogo'
          ? (dj?.price ?? null)
          : info.precio === 'rentaPorPersona'
            ? porPersona.renta
            : info.precio === 'alimentosPorPersona'
              ? porPersona.alimentos
              : null;
    return { ...info, precioSugerido };
  });
}

/** La cuenta completa: renglones, sus pagos y el saldo. */
export async function cuentaDelEvento(db: PrismaClient, quoteId: string) {
  const [cargos, pagos, devoluciones] = await Promise.all([
    db.cargoEvento.findMany({
      where: { quoteId },
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
      include: { registradoBy: { select: { nombre: true } } },
    }),
    db.payment.findMany({ where: { quoteId, destino: 'cargos' }, orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }] }),
    db.devolucion.findMany({ where: { quoteId, destino: 'cargos', anuladoAt: null }, select: { monto: true } }),
  ]);
  // Lo devuelto de la cuenta resta de lo cobrado.
  const netos = [...pagos, ...devoluciones.map((d) => ({ monto: -d.monto, anuladoAt: null }))];
  return { cargos, pagos, ...saldoDeCargos(cargos, netos) };
}

