import type { PrismaClient } from '@hsa/database';
import { resumenCancelacion } from '../quotes/ciclo.js';
import {
  estadoFacturaPago,
  hoyCivilMexico,
  requisitosFactura,
  partesDePago,
  formatFolio,
  saldoDeCargos,
  PRODUCTO_INFO,
} from '@hsa/shared';
import { loadEstadoCuentaBulk } from '../quotes/service.js';

/** Rango de fechas y paginación comunes a todos los endpoints del BI. */
export interface RangoBI {
  desde: Date;
  hasta: Date;
  limit: number;
  cursor?: string;
}

/**
 * El cursor de paginación es el `id` de la última fila, así que el orden tiene
 * que ser TOTAL: si solo se ordena por fecha, las filas que empatan quedan en
 * posición ambigua y la página siguiente repite unas y se salta otras (pasa de
 * verdad: varios eventos caen el mismo día). El `id` desempata.
 */
const DESEMPATE = { id: 'asc' } as const;

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
    orderBy: [{ fechaEvento: 'asc' }, DESEMPATE],
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  // La cuenta del punto de venta de cada evento, en bloque (sin N+1).
  const ids = quotes.map((q) => q.id);
  const [cargos, pagosCargos, codigos] = await Promise.all([
    db.cargoEvento.findMany({ where: { quoteId: { in: ids } }, select: { quoteId: true, total: true, anuladoAt: true } }),
    db.payment.findMany({
      where: { quoteId: { in: ids }, destino: 'cargos' },
      select: { quoteId: true, monto: true, anuladoAt: true },
    }),
    db.codigoEvento.findMany({
      where: { quoteId: { in: ids } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { quoteId: true, codigo: true, motivos: true, fechaEvento: true, createdAt: true },
    }),
  ]);
  // La cancelación de los cancelados: lo acordado, lo devuelto y lo que falta.
  const cancelaciones = new Map(
    await Promise.all(
      quotes.filter((q) => q.status === 'cancelada').map(async (q) => [q.id, await resumenCancelacion(db, q)] as const),
    ),
  );
  const historialDe = (id: string) =>
    codigos
      .filter((c) => c.quoteId === id)
      .map((c) => ({
        codigo: c.codigo,
        motivos: c.motivos,
        fechaEvento: c.fechaEvento.toISOString().slice(0, 10),
        desde: c.createdAt.toISOString(),
      }));
  const cuentaDe = (id: string) =>
    saldoDeCargos(
      cargos.filter((c) => c.quoteId === id),
      pagosCargos.filter((p) => p.quoteId === id),
    );
  return quotes.map((q) => ({
    id: q.id,
    // El código es el identificador principal. Cambia si el evento se mueve de
    // fecha o de salón; `codigos` trae todos los que ha tenido, del primero al
    // vigente, para cuadrar contra registros que tengan uno viejo.
    codigo: q.etiqueta,
    codigos: historialDe(q.id),
    // La llave interna que nunca cambia.
    folio: q.folio,
    // `bi` = se importó del BI (o se ligó a uno de allá); `hsa` = se vendió aquí.
    origen: q.importadoBI ? 'bi' : 'hsa',
    idBI: q.importadoBI,
    // Cuándo se vendió: la del BI para los importados, la de alta para los demás.
    contratadoEl: (q.contratadoEl ?? q.createdAt).toISOString().slice(0, 10),
    fechaEvento: q.fechaEvento.toISOString().slice(0, 10),
    // `standby` y `cancelada` sueltan la fecha: no ocupan agenda.
    estatus: q.status,
    // En standby, `fechaEvento` es la fecha que TENÍA.
    standby:
      q.status === 'standby'
        ? { desde: q.standbyDesde?.toISOString() ?? null, motivo: q.standbyMotivo, estatusPrevio: q.statusPrevio }
        : null,
    cancelacion: cancelaciones.get(q.id) ?? null,
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
    // Lo vendido DESPUÉS de contratar en el punto de venta (horas extra, multas,
    // daños). NO está en `total`: el valor del evento no cambia. Ver /cargos.
    cargosAdicionales: cuentaDe(q.id),
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
      quote: { select: { id: true, etiqueta: true, fechaEvento: true, client: { select: { nombre: true } } } },
      registradoBy: { select: { nombre: true } },
      anuladoBy: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'asc' }, DESEMPATE],
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
      folioLetra: p.folioLetra,
      folioTexto: formatFolio(p.folio, p.folioLetra),
      quoteId: p.quoteId,
      eventoCodigo: p.quote?.etiqueta ?? null,
      cliente: p.quote?.client?.nombre ?? null,
      fecha: p.fecha.toISOString().slice(0, 10),
      monto: p.monto,
      metodo: p.metodo,
      // Las partes del pago si vino dividido; los viejos traen una sola.
      formas: partesDePago(p),
      // El depósito del banquetero del que salió, si salió de uno: varios pagos
      // de un mismo depósito comparten su folio (es UNA entrada de dinero).
      pagoBanqueteroId: p.pagoBanqueteroId,
      // `evento` = abona a la renta contratada; `cargos` = a la cuenta del punto
      // de venta (otros ingresos del evento, fuera de su valor).
      destino: p.destino,
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
    select: { id: true, etiqueta: true, rentaTotal: true, fechaEvento: true, status: true, spaceIds: true, breakdown: true,
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
        eventoCodigo: q.etiqueta,
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
    include: { actor: { select: { nombre: true } }, quote: { select: { etiqueta: true, client: { select: { nombre: true } } } } },
    orderBy: [{ createdAt: 'asc' }, DESEMPATE],
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return logs.map((l) => ({
    id: l.id,
    quoteId: l.quoteId,
    eventoCodigo: l.quote?.etiqueta ?? null,
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
    orderBy: [{ fechaEvento: 'asc' }, DESEMPATE],
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

/**
 * Cada dinero que ENTRÓ, una fila por folio: la hoja foliada, digitalizada.
 *
 * `/pagos` cuenta aplicaciones a eventos y por eso repite folio cuando un
 * depósito se reparte. Esto no: es la entrada de dinero misma —pago directo,
 * depósito de banquetero o abono directo a una fecha apartada— y es lo que se
 * concilia contra el banco y contra la caja.
 *
 * Paginación por `fecha` + `id`, igual que los demás; el `id` va prefijado con
 * el tipo (`pago:…`, `deposito:…`, `abono:…`) para que el cursor sea único
 * entre las tres tablas.
 */
export async function biIngresos(db: PrismaClient, r: RangoBI) {
  const rango = { gte: r.desde, lte: r.hasta };
  const [pagos, depositos, abonos] = await Promise.all([
    db.payment.findMany({
      // Solo los directos: los que salieron de un depósito o de un abono ya
      // están contados en su entrada madre.
      where: { fecha: rango, pagoBanqueteroId: null, abonoApartado: null, quote: { deletedAt: null } },
      include: { quote: { select: { id: true, folio: true, etiqueta: true, client: { select: { nombre: true } } } } },
    }),
    db.pagoBanquetero.findMany({
      where: { fecha: rango },
      include: { banquetero: { select: { id: true, nombre: true } } },
    }),
    db.abonoApartado.findMany({
      where: { fecha: rango, pagoBanqueteroId: null },
      include: { apartado: { select: { id: true, banquetero: { select: { id: true, nombre: true } } } } },
    }),
  ]);
  const filas = [
    ...pagos.map((p) => ({
      id: `pago:${p.id}`,
      tipo: 'pago' as const,
      destino: p.destino as string | null,
      folio: p.folio as number | null,
      fecha: p.fecha,
      monto: p.monto,
      metodo: p.metodo,
      formas: partesDePago(p),
      referencia: p.referencia,
      anulado: p.anuladoAt != null,
      de: p.quote?.client?.nombre ?? null,
      quoteId: p.quoteId,
      eventoFolio: p.quote?.folio ?? null,
      eventoCodigo: p.quote?.etiqueta ?? null,
      banqueteroId: null as string | null,
      apartadoId: null as string | null,
    })),
    ...depositos.map((d) => ({
      id: `deposito:${d.id}`,
      tipo: 'deposito' as const,
      destino: null,
      folio: d.folio,
      fecha: d.fecha,
      monto: d.monto,
      metodo: d.metodo,
      formas: partesDePago(d),
      referencia: d.referencia,
      anulado: d.anuladoAt != null,
      de: d.banquetero.nombre,
      quoteId: null,
      eventoFolio: null,
      eventoCodigo: null,
      banqueteroId: d.banquetero.id,
      apartadoId: null,
    })),
    ...abonos.map((a) => ({
      id: `abono:${a.id}`,
      tipo: 'abono' as const,
      destino: null,
      folio: a.folio,
      fecha: a.fecha,
      monto: a.monto,
      metodo: a.metodo,
      formas: partesDePago(a),
      referencia: a.referencia,
      anulado: a.anuladoAt != null,
      de: a.apartado.banquetero.nombre,
      quoteId: null,
      eventoFolio: null,
      eventoCodigo: null,
      banqueteroId: a.apartado.banquetero.id,
      apartadoId: a.apartado.id,
    })),
  ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const desde = r.cursor ? filas.findIndex((f) => f.id === r.cursor) + 1 : 0;
  return filas.slice(desde, desde + r.limit).map((f) => ({
    ...f,
    folioTexto: formatFolio(f.folio),
    fecha: f.fecha.toISOString().slice(0, 10),
  }));
}

/**
 * Otros ingresos del evento: lo cargado a su cuenta en el punto de venta.
 *
 * Horas extra, DJ extra, invitados de más, multas, daños y gastos imprevistos.
 * No forman parte del valor del evento (`/eventos.total`); sus cobros llegan por
 * `/pagos` con `destino: "cargos"`. Incluye los anulados, marcados.
 *
 * Rango sobre `fecha` del cargo (el día de la venta).
 */
export async function biCargos(db: PrismaClient, r: RangoBI) {
  const cargos = await db.cargoEvento.findMany({
    where: { fecha: { gte: r.desde, lte: r.hasta }, quote: { deletedAt: null } },
    include: {
      quote: { select: { id: true, folio: true, etiqueta: true, fechaEvento: true, client: { select: { nombre: true } } } },
      registradoBy: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'asc' }, DESEMPATE],
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return cargos.map((c) => ({
    id: c.id,
    quoteId: c.quoteId,
    eventoFolio: c.quote.folio,
    eventoCodigo: c.quote.etiqueta,
    fechaEvento: c.quote.fechaEvento.toISOString().slice(0, 10),
    cliente: c.quote.client?.nombre ?? null,
    fecha: c.fecha.toISOString().slice(0, 10),
    producto: c.producto,
    productoNombre: PRODUCTO_INFO[c.producto].nombre,
    descripcion: c.descripcion,
    cantidad: c.cantidad,
    precioUnitario: c.precioUnitario,
    total: c.total,
    registradoPor: c.registradoBy?.nombre ?? null,
    anulado: c.anuladoAt != null,
    motivoAnulacion: c.motivoAnulacion,
  }));
}

/**
 * Dinero que SALIÓ: devoluciones a clientes (de la renta o de la cuenta del
 * punto de venta) y a banqueteros (de su saldo a favor). No llevan folio de la
 * serie I, que numera lo que entra. Incluye las anuladas, marcadas.
 *
 * Rango sobre `fecha` (cuándo salió el dinero).
 */
export async function biDevoluciones(db: PrismaClient, r: RangoBI) {
  const devs = await db.devolucion.findMany({
    where: { fecha: { gte: r.desde, lte: r.hasta } },
    include: {
      quote: { select: { id: true, folio: true, etiqueta: true, client: { select: { nombre: true } } } },
      banquetero: { select: { id: true, nombre: true } },
      pagoBanquetero: { select: { folio: true } },
      registradoBy: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'asc' }, DESEMPATE],
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return devs.map((d) => ({
    id: d.id,
    fecha: d.fecha.toISOString().slice(0, 10),
    monto: d.monto,
    metodo: d.metodo,
    formas: partesDePago(d),
    // `evento` / `cargos` para un cliente; `banquetero` para el saldo a favor.
    de: d.quoteId ? d.destino : 'banquetero',
    quoteId: d.quoteId,
    eventoFolio: d.quote?.folio ?? null,
    eventoCodigo: d.quote?.etiqueta ?? null,
    cliente: d.quote?.client?.nombre ?? d.banquetero?.nombre ?? null,
    banqueteroId: d.banqueteroId,
    depositoFolio: d.pagoBanquetero?.folio ?? null,
    motivo: d.motivo,
    referencia: d.referencia,
    notaCreditoUuid: d.notaCreditoUuid,
    registradoPor: d.registradoBy?.nombre ?? null,
    anulado: d.anuladoAt != null,
    motivoAnulacion: d.motivoAnulacion,
  }));
}
