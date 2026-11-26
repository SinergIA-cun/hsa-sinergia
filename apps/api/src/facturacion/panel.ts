import type { PrismaClient } from '@hsa/database';
import { mesSchema, pagosDelMes } from './facturar.js';

/*
 * El panel de Facturación (26-nov-2026) y lo que se le manda al BI.
 *
 * El panel tiene dos partes, en este orden (pedido de Fernando): lo facturado y
 * lo pendiente de facturar. El efectivo no aparece: no se factura ni se reporta
 * (de un pago mixto solo cuenta lo que no es efectivo; eso ya lo hace
 * `pagosDelMes`). Además se listan las facturas que el PAC tiene y que no salen
 * de ningún pago de la app (hechas a mano en el portal), y la última revisión.
 */

const OFFSET_CANCUN_H = 5;

/** Del día 1 del mes a las 0:00 de Cancún, al día 1 del mes siguiente. */
function rangoDelMes(mes: string): { desde: Date; hasta: Date } {
  const [y, m] = mesSchema.parse(mes).split('-').map(Number) as [number, number];
  return { desde: new Date(Date.UTC(y, m - 1, 1, OFFSET_CANCUN_H)), hasta: new Date(Date.UTC(y, m, 1, OFFSET_CANCUN_H)) };
}

const vistaFactura = (f: {
  uuid: string;
  fecha: Date;
  serie: string | null;
  folio: string | null;
  total: number;
  receptorRfc: string | null;
  receptorNombre: string | null;
  estatus: string | null;
  subestatus: string | null;
  cancelada: boolean;
  origen: string;
  tipoComprobante: string | null;
}) => ({
  uuid: f.uuid,
  fecha: f.fecha.toISOString(),
  serieFolio: [f.serie, f.folio].filter(Boolean).join('-') || null,
  total: f.total,
  receptorRfc: f.receptorRfc,
  receptorNombre: f.receptorNombre,
  estatus: f.subestatus ?? f.estatus,
  cancelada: f.cancelada,
  origen: f.origen,
  tipoComprobante: f.tipoComprobante,
});

/**
 * ¿Cuenta como facturado? Solo facturas de ingreso vigentes: un complemento de
 * pago ("Pago") o una nota de crédito ("Egreso") no son venta facturada, y una
 * cancelada ya no vale. El PAC las nombra "Ingreso"; la app guarda "Factura".
 */
export const cuentaComoFacturado = (f: { tipoComprobante: string | null; cancelada: boolean }) =>
  !f.cancelada && (!f.tipoComprobante || /^(ingreso|factura)$/i.test(f.tipoComprobante));

async function ultimaRevision(db: PrismaClient) {
  const r = await db.sincronizacionPac.findFirst({ orderBy: { inicio: 'desc' } });
  return r ? { inicio: r.inicio.toISOString(), ok: r.ok, nuevas: r.nuevas, actualizadas: r.actualizadas, error: r.error } : null;
}

export async function panelFacturacion(db: PrismaClient, mes: string, ahora = new Date()) {
  const base = await pagosDelMes(db, mes, ahora);
  const { desde, hasta } = rangoDelMes(mes);

  const uuidsDePagos = base.facturados.pagos.map((p) => p.facturaUuid?.toUpperCase()).filter((u): u is string => !!u);
  const [delPac, delMes, todosLosUuidsDePagos, revision] = await Promise.all([
    db.facturaPac.findMany({ where: { uuid: { in: uuidsDePagos } } }),
    db.facturaPac.findMany({ where: { fecha: { gte: desde, lt: hasta } }, orderBy: { fecha: 'asc' } }),
    db.payment.findMany({ where: { facturaUuid: { not: null } }, select: { facturaUuid: true } }),
    ultimaRevision(db),
  ]);
  const porUuid = new Map(delPac.map((f) => [f.uuid, f]));
  const ligadas = new Set(todosLosUuidsDePagos.map((p) => p.facturaUuid!.toUpperCase()));

  const facturados = base.facturados.pagos.map((p) => {
    const f = p.facturaUuid ? porUuid.get(p.facturaUuid.toUpperCase()) : undefined;
    return { ...p, pac: f ? vistaFactura(f) : null };
  });
  const suma = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
  const fueraDeLaApp = delMes.filter((f) => !ligadas.has(f.uuid));
  // Lo de la app cuenta salvo que el PAC diga que se canceló.
  const deLaAppVigentes = facturados.filter((p) => !p.pac?.cancelada);
  const fueraQueCuentan = fueraDeLaApp.filter(cuentaComoFacturado);

  return {
    mes,
    facturados: {
      cantidad: deLaAppVigentes.length + fueraQueCuentan.length,
      /** Facturas de ingreso vigentes del mes: las de la app más las hechas directo en el PAC. */
      monto: suma([...deLaAppVigentes.map((p) => p.montoFacturable), ...fueraQueCuentan.map((f) => f.total)]),
      /** De ese monto, lo que se facturó directo en el PAC. */
      montoFueraDeLaApp: suma(fueraQueCuentan.map((f) => f.total)),
      pagos: facturados,
    },
    pendientes: base.pendientes,
    /** Los que tienen parte que no es efectivo pero no se pueden facturar desde aquí, con el porqué. */
    noSeFacturan: base.noSeFacturan,
    /** Facturas del PAC de este mes que no salen de ningún pago de la app. */
    fueraDeLaApp: fueraDeLaApp.map(vistaFactura),
    ultimaRevision: revision,
  };
}

/**
 * Las facturas del PAC entre dos fechas para el BI, ligadas a su pago cuando
 * salen de la app. Fechas `AAAA-MM-DD` en hora de Cancún, `hasta` incluido.
 */
export async function facturasParaBI(db: PrismaClient, desde: string, hasta: string) {
  const ini = new Date(`${desde}T00:00:00-05:00`);
  const fin = new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 24 * 3600_000);
  const facturas = await db.facturaPac.findMany({ where: { fecha: { gte: ini, lt: fin } }, orderBy: { fecha: 'asc' } });
  const pagos = await db.payment.findMany({
    // El PAC puede regresar el UUID en mayúsculas o minúsculas: se buscan las dos.
    where: { facturaUuid: { in: facturas.flatMap((f) => [f.uuid, f.uuid.toLowerCase()]) } },
    select: { id: true, facturaUuid: true, folio: true, destino: true, quote: { select: { id: true, etiqueta: true } } },
  });
  const pagoDe = new Map(pagos.map((p) => [p.facturaUuid!.toUpperCase(), p]));
  return {
    desde,
    hasta,
    ultimaRevision: await ultimaRevision(db),
    facturas: facturas.map((f) => {
      const p = pagoDe.get(f.uuid);
      return {
        ...vistaFactura(f),
        idComprobante: f.idComprobante,
        serie: f.serie,
        folio: f.folio,
        tipoComprobante: f.tipoComprobante,
        subtotal: f.subtotal,
        impuestos: f.impuestos,
        moneda: f.moneda,
        formaPagoClave: f.formaPagoClave,
        formaPagoNombre: f.formaPagoNombre,
        estatusPac: f.estatus,
        subestatusPac: f.subestatus,
        pago: p ? { pagoId: p.id, folio: p.folio, destino: p.destino, quoteId: p.quote.id, eventoCodigo: p.quote.etiqueta } : null,
        actualizadoAt: f.actualizadoAt.toISOString(),
      };
    }),
  };
}
