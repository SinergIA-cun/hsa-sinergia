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
  ordenarEspacios,
  desgloseParaBI,
  type QuoteLine,
} from '@hsa/shared';
import { loadEstadoCuentaBulk, rentaBasePorEspacio } from '../quotes/service.js';
import { PRODUCTOS_DEL_CONTRATO } from '../cargos/contrato.js';

/** Rango de fechas y paginación comunes a todos los endpoints del BI. */
export interface RangoBI {
  desde: Date;
  hasta: Date;
  limit: number;
  cursor?: string;
  /**
   * Ids de EVENTOS. Si vienen, `/eventos`, `/pagos`, `/cargos` y `/devoluciones`
   * devuelven lo de esos eventos sin importar la fecha: es como el BI relee lo
   * que `/cambios` le dijo que cambió (una edición no mueve ninguna fecha).
   */
  ids?: string[];
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
  apartado: { select: { importadoBI: true } },
  priceList: { select: { ivaRate: true } },
  serviciosBanquetero: { select: { nombre: true, cantidad: true, monto: true }, orderBy: { id: 'asc' as const } },
};

/** Cómo se cuenta un servicio del catálogo según su tipo de cobro. */
const UNIDAD_DE_KIND = { fijo: 'evento', porPersona: 'personas', porUnidad: 'unidades' } as const;

type Breakdownish = { lines?: QuoteLine[] } | null;
const lineasDe = (b: unknown): QuoteLine[] => (b as Breakdownish)?.lines ?? [];

/**
 * Lo que el desglose de los eventos nombra por id (servicios y paquetes de SU
 * catálogo), traducido a su clave fija, su categoría y su proveedor. En bloque.
 */
async function referenciasDelDesglose(db: PrismaClient, lineas: QuoteLine[]) {
  const ids = (tipo: string) => [...new Set(lineas.filter((l) => l.ref?.tipo === tipo && l.ref.id).map((l) => l.ref!.id!))];
  const [servicios, paquetes, proveedores] = await Promise.all([
    db.addOn.findMany({
      where: { id: { in: ids('servicioCatalogo') } },
      select: { id: true, clave: true, categoria: true, comisionPct: true, proveedorId: true, cobra: true },
    }),
    db.foodPackage.findMany({ where: { id: { in: ids('alimentos') } }, select: { id: true, clave: true } }),
    db.proveedor.findMany({ select: { id: true, nombre: true } }),
  ]);
  return {
    servicio: new Map(servicios.map((a) => [a.id, a])),
    paquete: new Map(paquetes.map((p) => [p.id, p.clave])),
    proveedor: new Map(proveedores.map((p) => [p.id, p.nombre])),
  };
}

/**
 * `desglose[]` de un evento: cada renglón con la clave fija de lo que se vendió.
 *
 * Proveedor, comisión y quién cobra son los que se congelaron en el renglón al
 * guardar el evento (como el precio). Un evento guardado antes de eso los toma
 * del servicio en el catálogo DEL EVENTO. La comisión es sobre el subtotal sin IVA.
 *
 * Al final van los servicios que pone el banquetero (`bloque: banquetero`): NO
 * suman a `renta` ni a `otros`.
 */
function desgloseDelEvento(
  q: {
    id: string;
    breakdown: unknown;
    rentaTotal: number;
    total: number;
    priceList: { ivaRate: number } | null;
    banquetero: { id: string; nombre: string } | null;
    serviciosBanquetero: { nombre: string; cantidad: number; monto: number | null }[];
  },
  refs: Awaited<ReturnType<typeof referenciasDelDesglose>>,
) {
  const renglones = desgloseParaBI(lineasDe(q.breakdown), {
    quoteId: q.id,
    ivaRate: q.priceList?.ivaRate ?? 0.16,
    rentaTotal: q.rentaTotal,
    otrosTotal: q.total - q.rentaTotal,
  });
  const vendidos = renglones.map(({ refId, servicio: congelado, ...r }) => {
    const servicio = r.tipo === 'servicioCatalogo' && refId ? refs.servicio.get(refId) : undefined;
    const clave =
      r.tipo === 'servicioCatalogo' ? servicio?.clave ?? null
      : r.tipo === 'alimentos' ? (refId ? refs.paquete.get(refId) ?? null : null)
      : r.tipo === 'rentaSalon' || r.tipo === 'cargoContrato' ? refId
      : null;
    const datos = congelado ?? (servicio ? { proveedorId: servicio.proveedorId, comisionPct: servicio.comisionPct, cobra: servicio.cobra } : null);
    const pct = datos?.proveedorId ? datos.comisionPct : null;
    return {
      ...r,
      clave,
      categoria: servicio?.categoria ?? null,
      cobra: datos?.cobra ?? null,
      proveedor: datos?.proveedorId ? { clave: datos.proveedorId, nombre: refs.proveedor.get(datos.proveedorId) ?? null } : null,
      comision: pct != null ? { porcentaje: pct, monto: Math.round(r.subtotal * pct) / 100 } : null,
      banquetero: null as { id: string; nombre: string } | null,
    };
  });
  const delBanquetero = q.banquetero
    ? q.serviciosBanquetero.map((s, i) => ({
        id: `${q.id}:servicioBanquetero:${i + 1}`,
        bloque: 'banquetero' as const,
        tipo: 'servicioBanquetero' as const,
        nombre: s.nombre,
        detalle: null,
        cantidad: s.cantidad,
        unidad: 'unidades' as const,
        precioUnitario: s.monto != null ? Math.round((s.monto / s.cantidad) * 100) / 100 : null,
        subtotal: null,
        total: s.monto,
        origen: 'contrato' as const,
        cargoId: null,
        clave: null,
        categoria: null,
        cobra: null,
        proveedor: null,
        comision: null,
        banquetero: { id: q.banquetero!.id, nombre: q.banquetero!.nombre },
      }))
    : [];
  return [...vendidos, ...delBanquetero];
}

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
    where: r.ids ? { id: { in: r.ids }, deletedAt: null } : { fechaEvento: { gte: r.desde, lte: r.hasta }, deletedAt: null },
    include: incluirEvento,
    orderBy: [{ fechaEvento: 'asc' }, DESEMPATE],
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  const nombreEspacio = new Map((await db.space.findMany({ select: { id: true, nombre: true } })).map((s) => [s.id, s.nombre]));
  // La cuenta del punto de venta de cada evento, en bloque (sin N+1).
  const ids = quotes.map((q) => q.id);
  const [cargos, pagosCargos, codigos] = await Promise.all([
    // Solo los de la cuenta aparte: los que suben el contrato ya están en `total`.
    db.cargoEvento.findMany({
      where: { quoteId: { in: ids }, producto: { notIn: PRODUCTOS_DEL_CONTRATO } },
      select: { quoteId: true, total: true, anuladoAt: true },
    }),
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
  const refs = await referenciasDelDesglose(db, quotes.flatMap((q) => lineasDe(q.breakdown)));
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
    // Un evento que salió de convertir un apartado importado hereda su `idBI`.
    origen: q.importadoBI || q.apartado?.importadoBI ? 'bi' : 'hsa',
    idBI: q.importadoBI ?? q.apartado?.importadoBI ?? null,
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
    // Los mismos, por nombre y en el mismo orden.
    salones: q.spaceIds.map((id) => nombreEspacio.get(id) ?? id),
    // El principal es el PRIMERO de `espacios`: el que va en el código del evento
    // (`…-CUPULA`). `null` en un evento sin salón (solo capilla, sesión de fotos).
    salonPrincipal: q.spaceIds[0] ? { id: q.spaceIds[0], nombre: nombreEspacio.get(q.spaceIds[0]) ?? q.spaceIds[0] } : null,
    // La renta repartida entre sus salones, en proporción a la renta de catálogo
    // de cada uno (la misma regla que el plan de pagos). Suma `renta.total`, con
    // horas extra, descuentos y cargos que suben el contrato ya repartidos.
    rentaPorSalon: [...rentaBasePorEspacio(q.breakdown, q.spaceIds, q.rentaTotal)].map(([id, monto]) => ({
      espacioId: id,
      salon: nombreEspacio.get(id) ?? id,
      monto,
    })),
    // La capilla es una marca del evento: no cobra ni bloquea.
    usaCapilla: q.usaCapilla,
    capillaHorario: q.capillaHorario,
    esCortesia: q.esCortesia,
    // Descuento sobre la renta del local: de cortesía familiar o de promoción.
    esPromocion: q.esPromocion,
    // En porcentaje O en monto fijo (pesos con IVA): uno de los dos viene en null.
    descuento:
      q.descuentoPct || q.descuentoMonto
        ? { porcentaje: q.descuentoPct || null, monto: q.descuentoMonto ?? null, motivo: q.descuentoMotivo }
        : null,
    requiereFactura: q.requiereFactura,
    cliente: { id: q.clientId, nombre: q.client?.nombre ?? null, referencia: q.client?.numeroReferencia ?? null },
    vendedora: q.createdBy ? { id: q.createdBy.id, nombre: q.createdBy.nombre } : null,
    banquetero: q.banquetero ? { id: q.banquetero.id, nombre: q.banquetero.nombre } : null,
    // Dos bloques separados: la renta la cobra la hacienda, lo demás se paga al proveedor.
    renta: { subtotal: rentaSubtotalDe(q.breakdown), total: q.rentaTotal },
    otros: { total: q.total - q.rentaTotal },
    total: q.total,
    // Renglón por renglón, con la clave fija de lo vendido. Suma `renta.total` + `otros.total`.
    desglose: desgloseDelEvento(q, refs),
    // La cuenta APARTE del punto de venta (multas, daños, DJ, alimentos, PAX
    // banquete): NO está en `total`. Las horas extra de salón y los PAX extra sí
    // están en `total` y en `renta` (suben el contrato). Ver /cargos.
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
    where: r.ids ? { quoteId: { in: r.ids }, quote: { deletedAt: null } } : { fecha: { gte: r.desde, lte: r.hasta }, quote: { deletedAt: null } },
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
      // El `idBI` del pago si vino del BI (importado, o abono de un apartado
      // importado que se convirtió); `null` si nació en el Cotizador. Es la llave
      // del BI para no contar dos veces lo que ya tiene.
      idBI: p.importadoBI,
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
      // Lo que anotó quien registró el pago para entenderlo.
      notas: p.notas,
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

/**
 * Bitácora de los eventos: altas, ediciones, estatus, pagos y anulaciones,
 * cargos, devoluciones, facturas, datos fiscales, cambio de catálogo, standby,
 * cancelación, reprogramación, papelera y restauración. Es la fuente para leer
 * lo incremental: dice QUÉ evento cambió; lo de ese evento se relee con `?ids=`.
 */
export async function biCambios(db: PrismaClient, r: RangoBI) {
  const logs = await db.activityLog.findMany({
    // También los de eventos en la papelera: si no, el BI nunca se enteraría de
    // que un evento se eliminó (`eliminada`) ni de que volvió (`restaurada`).
    where: { createdAt: { gte: r.desde, lte: r.hasta } },
    include: {
      actor: { select: { nombre: true } },
      quote: { select: { etiqueta: true, deletedAt: true, client: { select: { nombre: true } } } },
    },
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
    // El evento está HOY en la papelera: ya no sale en /eventos ni en /pagos.
    eventoEnPapelera: l.quote?.deletedAt != null,
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
      include: { apartado: { select: { id: true, banquetero: { select: { id: true, nombre: true } }, client: { select: { nombre: true } } } } },
    }),
  ]);
  const filas = [
    ...pagos.map((p) => ({
      id: `pago:${p.id}`,
      tipo: 'pago' as const,
      idBI: p.importadoBI as string | null,
      destino: p.destino as string | null,
      folio: p.folio as number | null,
      fecha: p.fecha,
      monto: p.monto,
      metodo: p.metodo,
      formas: partesDePago(p),
      referencia: p.referencia,
      notas: p.notas,
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
      idBI: null as string | null,
      destino: null,
      folio: d.folio,
      fecha: d.fecha,
      monto: d.monto,
      metodo: d.metodo,
      formas: partesDePago(d),
      referencia: d.referencia,
      notas: d.notas,
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
      idBI: a.importadoBI,
      destino: null,
      folio: a.folio,
      fecha: a.fecha,
      monto: a.monto,
      metodo: a.metodo,
      formas: partesDePago(a),
      referencia: a.referencia,
      notas: a.notas,
      anulado: a.anuladoAt != null,
      // Un apartado puede ser de un banquetero o de un cliente directo.
      de: a.apartado.banquetero?.nombre ?? a.apartado.client?.nombre ?? null,
      quoteId: null,
      eventoFolio: null,
      eventoCodigo: null,
      banqueteroId: a.apartado.banquetero?.id ?? null,
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
    where: r.ids ? { quoteId: { in: r.ids }, quote: { deletedAt: null } } : { fecha: { gte: r.desde, lte: r.hasta }, quote: { deletedAt: null } },
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
    // `true` = sube el valor del contrato: ya está en `total` y `renta` de
    // /eventos y se cobra con pagos `destino: evento`. `false` = cuenta aparte.
    afectaContrato: PRODUCTO_INFO[c.producto].afectaContrato,
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
    where: r.ids ? { quoteId: { in: r.ids } } : { fecha: { gte: r.desde, lte: r.hasta } },
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

/**
 * `/apartados`: las fechas apartadas (pagadas sin todos los datos del evento),
 * por la fecha apartada. Tarea C6 del encargo del BI.
 *
 * `importadoBI` es el `idBI` con el que llegó, si vino del BI. Cuando un
 * apartado se convierte en evento, `quoteId` y `eventoFolio`/`eventoCodigo`
 * dicen a cuál: el evento ya se lee en `/eventos`.
 */
export async function biApartados(db: PrismaClient, r: RangoBI) {
  const apartados = await db.apartadoFecha.findMany({
    where: { fechaEvento: { gte: r.desde, lte: r.hasta } },
    include: {
      banquetero: { select: { id: true, nombre: true } },
      client: { select: { id: true, nombre: true } },
      eventType: { select: { nombre: true } },
      quote: { select: { id: true, folio: true, etiqueta: true, deletedAt: true } },
      abonos: { orderBy: [{ fecha: 'asc' }, { id: 'asc' }] },
    },
    orderBy: [{ fechaEvento: 'asc' }, DESEMPATE],
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  const espacios = new Map((await db.space.findMany({ select: { id: true, nombre: true } })).map((s) => [s.id, s.nombre]));
  // El mismo "hoy" que la disponibilidad: un apartado vence el día siguiente a `vence`.
  const hoy = hoyCivilMexico();
  return apartados.map((a) => {
    const vivos = a.abonos.filter((x) => x.anuladoAt == null);
    return {
      id: a.id,
      importadoBI: a.importadoBI,
      fecha: a.fechaEvento.toISOString().slice(0, 10),
      salones: a.spaceIds.map((id) => espacios.get(id) ?? id),
      tipoEvento: a.eventType?.nombre ?? null,
      banquetero: a.banquetero ? { id: a.banquetero.id, nombre: a.banquetero.nombre } : null,
      cliente: a.client ? { id: a.client.id, nombre: a.client.nombre } : null,
      precioAcordado: a.precioAcordado,
      usaCapilla: a.usaCapilla,
      abonado: vivos.reduce((s, x) => s + x.monto, 0),
      estado: a.quoteId
        ? 'convertido'
        : a.canceladoAt
          ? 'cancelado'
          : a.vence.getTime() < hoy.getTime()
            ? 'vencido'
            : 'vivo',
      vence: a.vence.toISOString().slice(0, 10),
      canceladoAt: a.canceladoAt?.toISOString() ?? null,
      motivoCancelacion: a.motivoCancelacion,
      quoteId: a.quote?.id ?? null,
      eventoFolio: a.quote?.folio ?? null,
      eventoCodigo: a.quote?.etiqueta ?? null,
      // El evento en que se convirtió está en la papelera (no sale en /eventos).
      eventoEnPapelera: a.quote?.deletedAt != null,
      abonos: a.abonos.map((x) => ({
        id: x.id,
        idBI: x.importadoBI,
        folio: x.folio,
        folioTexto: x.folio != null ? formatFolio(x.folio, x.folioLetra) : null,
        fecha: x.fecha.toISOString().slice(0, 10),
        monto: x.monto,
        metodo: x.metodo,
        formas: partesDePago(x),
        referencia: x.referencia,
        notas: x.notas,
        anulado: x.anuladoAt != null,
        // Al convertir, cada abono se vuelve un pago del evento (mismo folio).
        paymentId: x.paymentId,
      })),
      createdAt: a.createdAt.toISOString(),
    };
  });
}

/**
 * `/catalogos`: los valores fijos con los que vienen las demás rutas, para que el
 * BI traduzca sin adivinar. No pagina ni lleva rango.
 */
export async function biCatalogos(db: PrismaClient) {
  const [espacios, tipos, listas, servicios, paquetes, proveedores] = await Promise.all([
    db.space.findMany({ select: { id: true, nombre: true } }).then(ordenarEspacios),
    db.eventType.findMany({ select: { id: true, nombre: true, slug: true }, orderBy: { nombre: 'asc' } }),
    db.priceList.findMany({ orderBy: { anio: 'asc' } }),
    db.addOn.findMany({ orderBy: [{ priceListId: 'asc' }, { nombre: 'asc' }] }),
    db.foodPackage.findMany({
      include: { brackets: { orderBy: { min: 'asc' } }, eventType: { select: { id: true, nombre: true } } },
      orderBy: [{ priceListId: 'asc' }, { nombre: 'asc' }],
    }),
    db.proveedor.findMany({ orderBy: { nombre: 'asc' } }),
  ]);
  const nombreProveedor = new Map(proveedores.map((p) => [p.id, p.nombre]));
  return {
    espacios,
    tiposEvento: tipos,
    // Los catálogos de precios (uno por año). Cada evento se queda con el suyo.
    catalogos: listas.map((l) => ({ id: l.id, nombre: l.nombre, anio: l.anio, activo: l.activa, capillaSabado: l.capillaSabado, ivaRate: l.ivaRate })),
    // Servicios adicionales de TODOS los catálogos, tal como los tiene la hacienda.
    // `clave` es el mismo servicio de un año a otro; `id` cambia con el catálogo.
    servicios: servicios.map((a) => ({
      id: a.id,
      clave: a.clave,
      catalogoId: a.priceListId,
      nombre: a.nombre,
      categoria: a.categoria,
      tipoCobro: a.kind,
      unidad: UNIDAD_DE_KIND[a.kind],
      // Quién se lo cobra al cliente: `proveedor` (directo; le debe la comisión a la
      // hacienda) o `hacienda` (ella le paga al proveedor).
      cobra: a.cobra,
      // Sin IVA: al evento se le agrega.
      precio: a.price,
      activo: a.activo,
      proveedor: a.proveedorId ? { clave: a.proveedorId, nombre: nombreProveedor.get(a.proveedorId) ?? null } : null,
      comisionPct: a.comisionPct,
    })),
    paquetesAlimentos: paquetes.map((p) => ({
      id: p.id,
      clave: p.clave,
      catalogoId: p.priceListId,
      tipoEvento: p.eventType,
      nombre: p.nombre,
      ivaIncluido: p.ivaIncluido,
      incluye: p.incluye,
      precios: p.brackets.map((b) => ({ min: b.min, max: b.max, precioPorPersona: b.pricePerPerson })),
    })),
    proveedores: proveedores.map((p) => ({ clave: p.id, nombre: p.nombre, activo: p.activo })),
    tiposRenglon: [
      'rentaSalon', 'descuento', 'horasExtra', 'capilla', 'descuentoAlimentos', 'cargoContrato',
      'alimentos', 'servicioCatalogo', 'djHoraExtra', 'servicioEvento', 'pactado', 'otro', 'servicioBanquetero',
    ],
    estatusEvento: ['borrador', 'formalizada', 'complementada', 'liquidada', 'standby', 'cancelada'],
    // Las etiquetas del BI. `complemento` ya no se usa (5-oct-2026).
    conceptosPago: ['anticipo', 'aCuenta', 'finiquito'],
    destinosPago: ['evento', 'cargos'],
    productosCargo: Object.values(PRODUCTO_INFO).map((p) => ({
      producto: p.producto,
      nombre: p.nombre,
      unidad: p.unidad,
      afectaContrato: p.afectaContrato,
    })),
    tiposIngreso: ['pago', 'deposito', 'abono'],
    destinosDevolucion: ['evento', 'cargos', 'banquetero'],
    tiposCambio: [
      'creada', 'edicion', 'estatus', 'pago', 'pagoAnulado', 'cargo', 'cargoAnulado', 'devolucion', 'devolucionAnulada',
      'factura', 'fiscal', 'catalogo', 'standby', 'cancelada', 'reprogramada', 'eliminada', 'restaurada',
    ],
  };
}
