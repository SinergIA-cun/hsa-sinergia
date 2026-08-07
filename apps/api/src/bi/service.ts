import type { PrismaClient } from '@hsa/database';
import { estadoFacturaPago, hoyCivilMexico, requisitosFactura } from '@hsa/shared';
import { loadEstadoCuentaBulk } from '../quotes/service.js';

/** Rango de fechas y paginación comunes a todos los endpoints del BI. */
export interface RangoBI {
  desde: Date;
  hasta: Date;
  limit: number;
  cursor?: string;
}

const incluirEvento = {
  client: true,
  eventType: { select: { nombre: true, slug: true } },
  createdBy: { select: { id: true, nombre: true } },
  banquetero: { select: { id: true, nombre: true } },
};

/**
 * El desglose se guarda como JSON. Los eventos creados antes de que el motor
 * separara renta y "otros" NO traen `rentaSubtotal`: para esos se devuelve
 * `null` explícito en vez de dejar que la llave desaparezca del JSON, que es
 * como el BI se enteraría del hueco demasiado tarde.
 */
function rentaSubtotalDe(breakdown: unknown): number | null {
  const v = (breakdown as { rentaSubtotal?: unknown } | null)?.rentaSubtotal;
  return typeof v === 'number' ? v : null;
}

/** Eventos del rango, con su desglose separado en renta vs. proveedor. */
export async function biEventos(db: PrismaClient, r: RangoBI) {
  const quotes = await db.quote.findMany({
    where: { fechaEvento: { gte: r.desde, lte: r.hasta }, deletedAt: null },
    include: incluirEvento,
    orderBy: { fechaEvento: 'asc' },
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return quotes.map((q) => ({
    id: q.id,
    fechaEvento: q.fechaEvento.toISOString().slice(0, 10),
    estatus: q.status,
    tipoEvento: q.eventType?.nombre ?? null,
    invitados: q.invitados,
    espacios: q.spaceIds,
    esCortesia: q.esCortesia,
    requiereFactura: q.requiereFactura,
    cliente: { id: q.clientId, nombre: q.client?.nombre ?? null, referencia: q.client?.numeroReferencia ?? null },
    vendedora: q.createdBy ? { id: q.createdBy.id, nombre: q.createdBy.nombre } : null,
    banquetero: q.banquetero ? { id: q.banquetero.id, nombre: q.banquetero.nombre } : null,
    // Dos bloques separados: la renta la cobra la hacienda, lo demás se paga al proveedor.
    renta: { subtotal: rentaSubtotalDe(q.breakdown), total: q.rentaTotal },
    otros: { total: q.total - q.rentaTotal },
    total: q.total,
  }));
}

/** Pagos realmente recibidos en el rango, con su estado de facturación. */
export async function biPagos(db: PrismaClient, r: RangoBI) {
  // El mismo "hoy" que usa el candado en el resto del sistema: día civil de
  // México, no UTC. Con `new Date()` un pago se vería facturable unas horas de
  // más en el reporte que en la app.
  const ahora = hoyCivilMexico();
  const pagos = await db.payment.findMany({
    where: { fecha: { gte: r.desde, lte: r.hasta }, quote: { deletedAt: null } },
    include: {
      quote: { select: { id: true, fechaEvento: true, client: { select: { nombre: true } } } },
      registradoBy: { select: { nombre: true } },
      anuladoBy: { select: { nombre: true } },
    },
    orderBy: { fecha: 'asc' },
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return pagos.map((p) => {
    const est = estadoFacturaPago(
      { fecha: p.fecha, facturadoAt: p.facturadoAt, desbloqueoAt: p.desbloqueoAt, anuladoAt: p.anuladoAt },
      ahora,
    );
    return {
      id: p.id,
      folio: p.folio,
      quoteId: p.quoteId,
      cliente: p.quote?.client?.nombre ?? null,
      fecha: p.fecha.toISOString().slice(0, 10),
      monto: p.monto,
      metodo: p.metodo,
      concepto: p.concepto,
      registradoPor: p.registradoBy?.nombre ?? null,
      anulado: p.anuladoAt != null,
      anuladoPor: p.anuladoBy?.nombre ?? null,
      motivoAnulacion: p.motivoAnulacion,
      facturable: est.facturable,
      motivoFactura: est.motivo,
      facturadoAt: p.facturadoAt?.toISOString() ?? null,
      facturaUuid: p.facturaUuid,
    };
  });
}

/**
 * Hitos de cobro pendientes que vencen dentro del rango.
 *
 * A diferencia del resto, este endpoint NO pagina: las filas son hitos derivados
 * del plan de pagos y no tienen `id` propio con el cual construir un cursor. El
 * `take` acota los EVENTOS con compromiso que se examinan (no las filas), así que
 * con más de `limit` eventos formalizados el resultado se trunca en silencio.
 * El `orderBy` está para que al menos sea determinista cuál se queda fuera.
 */
export async function biPagosEsperados(db: PrismaClient, r: RangoBI) {
  const quotes = await db.quote.findMany({
    where: { deletedAt: null, status: { in: ['formalizada', 'complementada'] } },
    select: { id: true, rentaTotal: true, fechaEvento: true, status: true, spaceIds: true, breakdown: true,
              client: { select: { nombre: true } } },
    orderBy: { fechaEvento: 'asc' },
    take: r.limit,
  });
  const estados = await loadEstadoCuentaBulk(db, quotes);
  const filas: unknown[] = [];
  for (const q of quotes) {
    const ec = estados.get(q.id);
    if (!ec?.plan) continue;
    for (const hito of ec.plan) {
      if (hito.completo || !hito.venceISO) continue;
      const vence = new Date(hito.venceISO);
      if (vence < r.desde || vence > r.hasta) continue;
      filas.push({
        quoteId: q.id,
        cliente: q.client?.nombre ?? null,
        hito: hito.key,
        etiqueta: hito.label,
        objetivo: hito.objetivo,
        cubierto: hito.cubierto,
        restante: hito.restante,
        venceISO: hito.venceISO,
      });
    }
  }
  return filas;
}

/** Bitácora: cambios de salón, invitados, fecha, estatus y pagos. */
export async function biCambios(db: PrismaClient, r: RangoBI) {
  const logs = await db.activityLog.findMany({
    where: { createdAt: { gte: r.desde, lte: r.hasta }, quote: { deletedAt: null } },
    include: { actor: { select: { nombre: true } }, quote: { select: { client: { select: { nombre: true } } } } },
    orderBy: { createdAt: 'asc' },
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return logs.map((l) => ({
    id: l.id,
    quoteId: l.quoteId,
    cliente: l.quote?.client?.nombre ?? null,
    tipo: l.tipo,
    descripcion: l.descripcion,
    detalle: l.meta,
    actor: l.actor?.nombre ?? null,
    fecha: l.createdAt.toISOString(),
  }));
}

/** Datos fiscales de los eventos que pidieron factura, con lo que falta. */
export async function biFacturacion(db: PrismaClient, r: RangoBI) {
  const quotes = await db.quote.findMany({
    where: { fechaEvento: { gte: r.desde, lte: r.hasta }, deletedAt: null, requiereFactura: true },
    include: { client: true },
    orderBy: { fechaEvento: 'asc' },
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return quotes.map((q) => {
    const req = requisitosFactura(q.client ?? {});
    return {
      quoteId: q.id,
      fechaEvento: q.fechaEvento.toISOString().slice(0, 10),
      total: q.total,
      cliente: {
        id: q.clientId,
        nombre: q.client?.nombre ?? null,
        rfc: q.client?.rfc ?? null,
        razonSocial: q.client?.razonSocial ?? null,
        regimenFiscal: q.client?.regimenFiscal ?? null,
        cpFiscal: q.client?.cpFiscal ?? null,
        usoCfdi: q.client?.usoCfdi ?? null,
        correoFacturacion: q.client?.correoFacturacion ?? null,
      },
      faltantes: req.filter((x) => !x.ok).map((x) => x.label),
    };
  });
}
