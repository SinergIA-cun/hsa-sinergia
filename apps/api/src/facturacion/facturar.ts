import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import {
  cfdiDePago,
  estadoFacturaPago,
  faltanDatosFactura,
  formatFolio,
  hoyCivilMexico,
  informacionGlobalDiaria,
  partesDePago,
  partesFacturables,
  receptorPublicoGeneral,
  requisitosFactura,
  type EmisorCfdi,
  type ReceptorCfdi,
} from '@hsa/shared';
import { Facturador, FacturadorError, facturadorDesdeEnv, serieParaFacturas, type ResultadoComprobante } from './facturador.js';
import { QuoteError, ownershipWhere, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import type { Mailer } from '../correos/mailer.js';

/*
 * Facturar pagos con el PAC (Facturador.com). Reglas (Fernando, 16 y 30-oct-2026):
 *  - Cada pago se factura por separado, en el mes en que entró (el candado).
 *  - El efectivo no se factura; de un pago mixto, solo las partes que no son efectivo.
 *  - Si el evento pidió factura y el cliente tiene sus datos completos, a él;
 *    si no, a público en general, pago por pago.
 * Se factura desde el pago (botón "Facturar") o desde el BI, uno, varios o todos
 * los pendientes del mes. La factura global automática a fin de mes NO existe
 * todavía: se decidió esperar a que esto funcione a mano.
 */

/** Lo que se usa del PAC. Es una interfaz para que las pruebas no timbren de verdad. */
export interface PAC {
  emitir(comprobante: unknown): Promise<ResultadoComprobante>;
  xml(uuid: string): Promise<string>;
  pdf(uuid: string): Promise<Buffer>;
}

export interface ContextoFactura {
  pac: PAC;
  emisor: EmisorCfdi;
  serie: { nombre: string; id: number };
  concepto: { claveProdServ: string; claveUnidad: string };
}

/** Da el contexto para timbrar (lo pide al PAC la primera vez y lo guarda). */
export type ProveedorFactura = () => Promise<ContextoFactura>;

/**
 * El proveedor real, desde el entorno: las llaves FACTURADOR_*, los datos del
 * emisor (FACTURADOR_EMISOR_NOMBRE/REGIMEN/CP), la serie (FACTURADOR_SERIE o la
 * primera de facturas) y las claves SAT del concepto (FACTURADOR_CLAVE_PROD_SERV
 * y FACTURADOR_CLAVE_UNIDAD). `null` si faltan las llaves: no se factura.
 */
export function proveedorDesdeEnv(env: NodeJS.ProcessEnv = process.env): ProveedorFactura | null {
  const config = facturadorDesdeEnv(env);
  if (!config) return null;
  let cache: Promise<ContextoFactura> | null = null;
  const armar = async (): Promise<ContextoFactura> => {
    const nombre = env.FACTURADOR_EMISOR_NOMBRE?.trim();
    const regimen = env.FACTURADOR_EMISOR_REGIMEN?.trim();
    const cp = env.FACTURADOR_EMISOR_CP?.trim();
    if (!nombre || !regimen || !cp) {
      throw new FacturadorError('Faltan FACTURADOR_EMISOR_NOMBRE, FACTURADOR_EMISOR_REGIMEN o FACTURADOR_EMISOR_CP.');
    }
    const f = new Facturador(config);
    const { emisorId, rfc } = await f.emisor();
    const serie = serieParaFacturas(await f.series(emisorId), env.FACTURADOR_SERIE?.trim() || undefined);
    if (!serie) throw new FacturadorError('La cuenta del PAC no tiene una serie de facturas.');
    return {
      pac: {
        emitir: (c) => f.emitir(emisorId, c),
        xml: (uuid) => f.xml(emisorId, uuid),
        pdf: async (uuid) => {
          const r = await fetch(await f.pdfUrl(emisorId, uuid));
          if (!r.ok) throw new FacturadorError(`No se pudo bajar el PDF (${r.status}).`, r.status);
          return Buffer.from(await r.arrayBuffer());
        },
      },
      emisor: { rfc, nombre, regimenFiscal: regimen, codigoPostal: cp },
      serie: { nombre: serie.nombre, id: serie.id },
      concepto: {
        claveProdServ: env.FACTURADOR_CLAVE_PROD_SERV?.trim() || '01010101',
        claveUnidad: env.FACTURADOR_CLAVE_UNIDAD?.trim() || 'E48',
      },
    };
  };
  return () => {
    // Si falló (red, llaves), la siguiente vez se vuelve a intentar.
    cache ??= armar().catch((e) => {
      cache = null;
      throw e;
    });
    return cache;
  };
}

const incluirPago = {
  quote: {
    select: {
      id: true,
      folio: true,
      etiqueta: true,
      deletedAt: true,
      requiereFactura: true,
      priceListId: true,
      client: {
        select: {
          nombre: true,
          correo: true,
          rfc: true,
          razonSocial: true,
          regimenFiscal: true,
          cpFiscal: true,
          usoCfdi: true,
          correoFacturacion: true,
        },
      },
    },
  },
} satisfies Prisma.PaymentInclude;

type PagoConEvento = Prisma.PaymentGetPayload<{ include: typeof incluirPago }>;

export interface AnalisisFactura {
  facturable: boolean;
  /** Por qué no, para la operación. `null` si se puede. */
  motivo: string | null;
  /** Lo que se factura: el pago sin su efectivo. */
  monto: number;
  partes: { forma: string; monto: number }[];
  /** A quién: al cliente (pidió factura y tiene sus datos) o a público en general. */
  receptor: { tipo: 'cliente' | 'publicoGeneral'; rfc: string; nombre: string };
  /** El evento pidió factura. Si va a público en general, es porque le faltan datos. */
  pidioFactura: boolean;
  faltantes: string[];
}

/** El receptor fiscal del pago, o `null` = público en general. */
function receptorCliente(p: PagoConEvento): ReceptorCfdi | null {
  const c = p.quote.client;
  if (!p.quote.requiereFactura || !c || faltanDatosFactura(c)) return null;
  return {
    rfc: c.rfc!.trim().toUpperCase(),
    nombre: c.razonSocial!.trim().toUpperCase(),
    regimenFiscal: c.regimenFiscal!,
    codigoPostal: c.cpFiscal!,
    usoCfdi: c.usoCfdi!,
  };
}

/** Qué pasaría si se factura este pago hoy. No llama al PAC. */
export function analizarPago(p: PagoConEvento, hoy = hoyCivilMexico()): AnalisisFactura {
  const { partes, monto } = partesFacturables(partesDePago(p));
  const cliente = receptorCliente(p);
  const faltantes = p.quote.requiereFactura ? requisitosFactura(p.quote.client ?? {}).filter((r) => !r.ok).map((r) => r.label) : [];
  const base = {
    monto,
    partes,
    receptor: cliente
      ? { tipo: 'cliente' as const, rfc: cliente.rfc, nombre: cliente.nombre }
      : { tipo: 'publicoGeneral' as const, rfc: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL' },
    pidioFactura: p.quote.requiereFactura,
    faltantes,
  };
  const no = (motivo: string) => ({ ...base, facturable: false, motivo });
  if (p.quote.deletedAt) return no('El evento está en la papelera.');
  const candado = estadoFacturaPago(p, hoy);
  if (!candado.facturable) return no(candado.motivo ?? 'No se puede facturar.');
  // El dinero lo puso el banquetero: el receptor no es el cliente del evento.
  if (p.pagoBanqueteroId) return no('Salió de un depósito del banquetero: por ahora se factura a mano en el PAC.');
  if (monto <= 0) return no('Pago en efectivo: no se factura.');
  return { ...base, facturable: true, motivo: null };
}

const DESCRIPCION: Record<string, string> = {
  evento: 'Renta de instalaciones para evento',
  cargos: 'Servicios adicionales del evento',
  banquete: 'Servicio de banquete del evento',
};

/** "2026-10-30T10:15:00": la hora de México, sin zona, como la pide el CFDI. */
function fechaLocalMexico(ahora: Date): string {
  return new Date(ahora.getTime() - 6 * 3600_000).toISOString().slice(0, 19);
}

// Un pago que se está timbrando: un doble clic o el BI y la app al mismo tiempo
// no deben sacar dos facturas del mismo pago. La API corre en una sola instancia.
const enCurso = new Set<string>();

export interface ResultadoFactura {
  pagoId: string;
  folioTexto: string;
  uuid: string;
  monto: number;
  receptor: AnalisisFactura['receptor'];
  /** `enviado`, `sinCorreo` (público en general o sin dirección), `sinSmtp`, o el error. */
  correo: string;
}

export interface OpcionesFactura {
  proveedor: ProveedorFactura | null;
  mailer: Mailer | null;
  actorId: string | null;
  /** Quién la pidió, para la bitácora. */
  origen: 'app' | 'BI';
  ahora?: Date;
}

/** Timbra un pago con el PAC, lo sella como facturado y le manda la factura al cliente. */
export async function facturarPago(db: PrismaClient, paymentId: string, o: OpcionesFactura): Promise<ResultadoFactura> {
  if (!o.proveedor) throw new QuoteError(503, 'El PAC no está configurado: no se puede facturar.');
  if (enCurso.has(paymentId)) throw new QuoteError(409, 'Este pago ya se está facturando.');
  enCurso.add(paymentId);
  try {
    const p = await db.payment.findUnique({ where: { id: paymentId }, include: incluirPago });
    if (!p) throw new QuoteError(404, 'Pago no encontrado');
    const ahora = o.ahora ?? new Date();
    const a = analizarPago(p, hoyCivilMexico(ahora));
    if (!a.facturable) throw new QuoteError(409, a.motivo ?? 'No se puede facturar.');

    let ctx: ContextoFactura;
    try {
      ctx = await o.proveedor();
    } catch (e) {
      throw new QuoteError(503, `No se pudo conectar con el PAC: ${e instanceof Error ? e.message : String(e)}`);
    }
    const lista = await db.priceList.findUnique({ where: { id: p.quote.priceListId }, select: { ivaRate: true } });
    const fecha = fechaLocalMexico(ahora);
    const cliente = receptorCliente(p);
    const folioTexto = formatFolio(p.folio, p.folioLetra);
    const evento = p.quote.etiqueta ?? String(p.quote.folio);
    const cfdi = cfdiDePago({
      emisor: ctx.emisor,
      receptor: cliente ?? receptorPublicoGeneral(ctx.emisor.codigoPostal),
      concepto: { ...ctx.concepto, descripcion: `${DESCRIPCION[p.destino] ?? 'Servicios del evento'} ${evento} · recibo ${folioTexto}` },
      montoConIva: a.monto,
      partes: a.partes,
      fecha,
      ivaRate: lista?.ivaRate ?? 0.16,
      serie: ctx.serie.nombre,
      serieId: ctx.serie.id,
      ...(cliente ? {} : { informacionGlobal: informacionGlobalDiaria(fecha) }),
    });

    let r: ResultadoComprobante;
    try {
      r = await ctx.pac.emitir(cfdi);
    } catch (e) {
      throw new QuoteError(502, `El PAC no respondió: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!r.esValido || !r.uuid) {
      const errores = (r.errores ?? []).map((x) => `${x.codigo} ${x.mensaje}`).join('; ') || r.descripcion || 'sin detalle';
      throw new QuoteError(502, `El PAC rechazó la factura: ${errores}`);
    }

    await db.payment.update({ where: { id: p.id }, data: { facturadoAt: ahora, facturaUuid: r.uuid, desbloqueoAt: null } });
    const aQuien = a.receptor.tipo === 'cliente' ? `${a.receptor.nombre} (${a.receptor.rfc})` : 'público en general';
    await logActivity(db, {
      quoteId: p.quoteId,
      tipo: 'factura',
      descripcion: `Pago ${folioTexto} facturado con el PAC a ${aQuien} por $${a.monto} (UUID ${r.uuid})${o.origen === 'BI' ? ' desde el BI' : ''}`,
      meta: { paymentId: p.id, folio: p.folio, facturaUuid: r.uuid, monto: a.monto, receptor: a.receptor, origen: o.origen },
      actorId: o.actorId,
    });

    const correo = await mandarFactura(ctx, o.mailer, p, r.uuid, a, folioTexto, evento);
    return { pagoId: p.id, folioTexto, uuid: r.uuid, monto: a.monto, receptor: a.receptor, correo };
  } finally {
    enCurso.delete(paymentId);
  }
}

/** Le manda al cliente su factura (XML y PDF). Si falla, la factura ya está hecha: solo se informa. */
async function mandarFactura(
  ctx: ContextoFactura,
  mailer: Mailer | null,
  p: PagoConEvento,
  uuid: string,
  a: AnalisisFactura,
  folioTexto: string,
  evento: string,
): Promise<string> {
  const para = p.quote.client?.correoFacturacion?.trim() || p.quote.client?.correo?.trim();
  if (a.receptor.tipo !== 'cliente' || !para) return 'sinCorreo';
  if (!mailer) return 'sinSmtp';
  try {
    const [xml, pdf] = await Promise.all([ctx.pac.xml(uuid), ctx.pac.pdf(uuid)]);
    const texto = `Hola, te mandamos la factura de tu pago ${folioTexto} del evento ${evento} por $${a.monto.toLocaleString('es-MX', { minimumFractionDigits: 2 })}. Folio fiscal: ${uuid}.`;
    await mailer.send({
      to: para,
      subject: `Factura de tu pago ${folioTexto}`,
      text: texto,
      html: `<p>${texto}</p>`,
      attachments: [
        { filename: `${uuid}.xml`, content: Buffer.from(xml, 'utf8'), contentType: 'application/xml' },
        { filename: `${uuid}.pdf`, content: pdf, contentType: 'application/pdf' },
      ],
    });
    return 'enviado';
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Cada pago por separado, en orden. Un error no detiene a los demás. */
export async function facturarVarios(db: PrismaClient, ids: string[], o: OpcionesFactura) {
  const resultados: ({ pagoId: string; ok: true } & ResultadoFactura | { pagoId: string; ok: false; error: string })[] = [];
  for (const id of ids) {
    try {
      resultados.push({ ok: true, ...(await facturarPago(db, id, o)) });
    } catch (e) {
      resultados.push({ pagoId: id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return {
    facturados: resultados.filter((r) => r.ok).length,
    fallidos: resultados.filter((r) => !r.ok).length,
    resultados,
  };
}

/** Vista previa para el botón: a quién y cuánto, sin timbrar. Respeta de quién es el evento. */
export async function vistaPreviaFactura(db: PrismaClient, quoteId: string, paymentId: string, actor: Actor) {
  const p = await db.payment.findFirst({
    where: { id: paymentId, quoteId, quote: ownershipWhere(actor) },
    include: incluirPago,
  });
  if (!p) throw new QuoteError(404, 'Pago no encontrado');
  return analizarPago(p);
}

/** El UUID de un pago del evento, si está facturado (para bajar el PDF). */
export async function uuidDePago(db: PrismaClient, quoteId: string, paymentId: string, actor: Actor): Promise<string> {
  const p = await db.payment.findFirst({ where: { id: paymentId, quoteId, quote: ownershipWhere(actor) }, select: { facturaUuid: true } });
  if (!p) throw new QuoteError(404, 'Pago no encontrado');
  if (!p.facturaUuid) throw new QuoteError(404, 'Este pago no tiene folio fiscal.');
  return p.facturaUuid;
}

export const mesSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mes como AAAA-MM');

/** El mes en curso en México, "2026-10". */
export const mesActual = (ahora = new Date()) => hoyCivilMexico(ahora).toISOString().slice(0, 7);

/**
 * Los pagos de un mes para facturar: los pendientes (con su monto sin efectivo y
 * a quién irían), los ya facturados, y los que no se facturan con el porqué. Los
 * desbloqueados de meses anteriores también salen como pendientes.
 */
export async function pagosDelMes(db: PrismaClient, mes: string, ahora = new Date()) {
  const [y, m] = mesSchema.parse(mes).split('-').map(Number) as [number, number];
  const desde = new Date(Date.UTC(y, m - 1, 1));
  const hasta = new Date(Date.UTC(y, m, 1));
  const pagos = await db.payment.findMany({
    where: {
      anuladoAt: null,
      quote: { deletedAt: null },
      OR: [{ fecha: { gte: desde, lt: hasta } }, { desbloqueoAt: { not: null }, facturadoAt: null }],
    },
    include: incluirPago,
    orderBy: [{ fecha: 'asc' }, { folio: 'asc' }],
  });
  const hoy = hoyCivilMexico(ahora);
  const fila = (p: PagoConEvento, a: AnalisisFactura) => ({
    pagoId: p.id,
    quoteId: p.quoteId,
    eventoCodigo: p.quote.etiqueta,
    eventoFolio: p.quote.folio,
    cliente: p.quote.client?.nombre ?? null,
    folioTexto: formatFolio(p.folio, p.folioLetra),
    fecha: p.fecha.toISOString().slice(0, 10),
    destino: p.destino,
    montoPago: p.monto,
    montoFacturable: a.monto,
    formas: partesDePago(p),
    receptor: a.receptor,
    pidioFactura: a.pidioFactura,
    faltantes: a.faltantes,
    facturaUuid: p.facturaUuid,
    facturadoAt: p.facturadoAt?.toISOString() ?? null,
    motivo: a.motivo,
  });
  const pendientes = [];
  const facturados = [];
  const noSeFacturan = [];
  for (const p of pagos) {
    const a = analizarPago(p, hoy);
    if (p.facturadoAt) facturados.push(fila(p, a));
    else if (a.facturable) pendientes.push(fila(p, a));
    // El efectivo puro no se lista: nunca se factura y solo haría ruido.
    else if (a.monto > 0) noSeFacturan.push(fila(p, a));
  }
  const suma = (xs: { montoFacturable: number }[]) => Math.round(xs.reduce((s, x) => s + x.montoFacturable, 0) * 100) / 100;
  return {
    mes,
    pendientes: { cantidad: pendientes.length, monto: suma(pendientes), pagos: pendientes },
    facturados: { cantidad: facturados.length, pagos: facturados },
    noSeFacturan,
  };
}
