import { z } from 'zod';
import { notasSchema, notaONull, editarNotasSchema } from './notas.js';
import type { PrismaClient } from '@hsa/database';
import {
  estadoFacturaPago,
  hoyCivilMexico,
  paymentConceptSchema,
  metodoCapturaSchema,
  formasPagoSchema,
  resolverFormasPago,
  describirFormasPago,
  formatFolio,
  FormasPagoError,
  type MetodoPago,
  type PartePago,
} from '@hsa/shared';
import { QuoteError, ownershipWhere, loadEstadoCuenta, assertNotTrashed, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import { archivarEvento } from '../historico/archivar.js';
import { esUpgrade, type PaymentStatus } from '../quotes/estadoCuenta.js';
import { reclasificarConceptos } from './conceptos.js';
import { folioPapelSchema, subirSecuenciaSobre, validarFolioDePapel } from './folios.js';
import type { ComprobanteStorage } from './storage.js';
import { validarCobroDeCargos, descripcionPagoCargos } from '../cargos/service.js';

export const registerPaymentSchema = z.object({
  monto: z.number().int().positive(),
  /**
   * Una sola forma de pago. Sigue existiendo para los procesos que capturan un
   * solo método (y para una pantalla vieja en caché). Si viene `formas`, manda
   * `formas`.
   */
  metodo: metodoCapturaSchema.optional(),
  /**
   * El pago dividido: "toma mi débito y mi crédito". Es UN pago con UN folio; las
   * partes tienen que sumar el monto.
   */
  formas: formasPagoSchema.optional(),
  /**
   * Lo que se capturó. Ya NO decide el concepto del pago: ese se deduce de dónde
   * deja el acumulado contra los hitos del plan. Sigue sirviendo de respaldo para
   * las cotizaciones SIN plan de pagos (los espacios cuyos montos no están
   * definidos), donde no hay hitos que cruzar y no hay nada que deducir.
   */
  concepto: paymentConceptSchema.default('aCuenta'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referencia: z.string().optional(),
  notas: notasSchema.optional(),
  /**
   * A qué va el pago. `evento` (lo de siempre) abona a la renta contratada y
   * mueve el plan de pagos. `cargos` abona a la cuenta del punto de venta —horas
   * extra, multas, daños— y NO toca el plan ni el valor del evento.
   */
  destino: z.enum(['evento', 'cargos']).default('evento'),
  /** El número de la hoja de papel, si el recibo se llenó a mano. Solo admin. */
  folioPapel: folioPapelSchema.optional(),
});

export const anularSchema = z.object({ motivo: z.string().min(3) });

/** Corrección a mano del concepto de un pago (para discrepar de la deducción). */
export const conceptoSchema = z.object({ concepto: paymentConceptSchema });

async function findOwnedQuote(db: PrismaClient, id: string, actor: Actor) {
  const quote = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(quote);
  return quote;
}

/**
 * Lo que solo trae un pago que NACE de una asignación de depósito de banquetero
 * (`banqueteros/cuenta.ts`): la liga al depósito madre y su comprobante, que es
 * el mismo movimiento bancario para todos los pagos que salieron de él.
 *
 * No es parte del esquema de captura a propósito: nadie debe poder colgar un pago
 * de un depósito desde el formulario.
 */
export interface OrigenDeposito {
  pagoBanqueteroId?: string;
  comprobanteKey?: string | null;
  comprobanteMime?: string | null;
  /**
   * El folio del dinero que entró. Un pago que sale de repartir un depósito (o de
   * convertir un abono) NO es dinero nuevo: lleva el folio de la entrada de la
   * que salió. `null`/ausente = gasta un folio nuevo de la secuencia (que es lo
   * que pasa también con los depósitos y abonos viejos, que no tienen folio).
   */
  folio?: number | null;
  /** La letra de esta aplicación dentro de su depósito (`I 5340-B`). */
  folioLetra?: string | null;
  /**
   * La forma de pago heredada de la entrada madre. Un depósito dividido repartido
   * en tres eventos no dice cuánto de cada forma le tocó a cada uno, así que el
   * pago queda `mixto` sin partes y el detalle vive en el depósito.
   */
  metodo?: MetodoPago;
  formas?: PartePago[] | null;
}

/** `resolverFormasPago` con el error convertido en un 400 legible. */
export function resolverOError(
  input: Parameters<typeof resolverFormasPago>[0],
): { metodo: MetodoPago; formas: PartePago[] | null } {
  try {
    return resolverFormasPago(input);
  } catch (e) {
    if (e instanceof FormasPagoError) throw new QuoteError(400, e.message);
    throw e;
  }
}

/** La forma de pago que se guarda: la heredada si la hay, si no la capturada. */
function formasAGuardar(
  input: z.infer<typeof registerPaymentSchema>,
  origen?: OrigenDeposito,
): { metodo: MetodoPago; formas: PartePago[] | null } {
  if (origen?.metodo) return { metodo: origen.metodo, formas: origen.formas ?? null };
  return resolverOError(input);
}

export async function registerPayment(
  db: PrismaClient,
  storage: ComprobanteStorage,
  quoteId: string,
  rawInput: unknown,
  actor: Actor,
  file?: { data: Buffer; mime: string },
  origen?: OrigenDeposito,
) {
  const quote = await findOwnedQuote(db, quoteId, actor);
  // A un evento cancelado ya no entra dinero: lo que queda es devolver (o
  // reactivarlo). En standby sí se puede seguir pagando; solo no sube de estatus.
  if (quote.status === 'cancelada') {
    throw new QuoteError(409, 'El evento está cancelado: no se le registran pagos.');
  }
  const input = registerPaymentSchema.parse(rawInput);
  const { metodo, formas } = formasAGuardar(input, origen);
  // Un pago que sale de un depósito o de un abono ya trae el folio de su entrada.
  const folioPapel = origen?.folio == null ? input.folioPapel : undefined;
  if (folioPapel != null) await validarFolioDePapel(db, folioPapel, actor);
  // Un depósito de banquetero o un abono solo pagan la renta del evento: la
  // cuenta del punto de venta se cobra en el mostrador.
  if (input.destino === 'cargos') {
    if (origen?.pagoBanqueteroId) throw new QuoteError(400, 'Un depósito se reparte a eventos, no a su cuenta de cargos.');
    await validarCobroDeCargos(db, quote, input.monto);
  }

  let comprobanteKey: string | null = origen?.comprobanteKey ?? null;
  let comprobanteMime: string | null = origen?.comprobanteMime ?? null;
  if (file) {
    const stored = await storage.save(file.data, file.mime);
    comprobanteKey = stored.key;
    comprobanteMime = stored.mime;
  }

  const payment = await db.payment.create({
    data: {
      quoteId,
      monto: input.monto,
      metodo,
      // `Prisma.DbNull` no hace falta: `undefined` deja la columna en NULL.
      formas: formas ?? undefined,
      concepto: input.concepto,
      fecha: new Date(`${input.fecha}T00:00:00.000Z`),
      referencia: input.referencia ?? null,
      notas: notaONull(input.notas),
      comprobanteKey,
      comprobanteMime,
      registradoById: actor.id,
      pagoBanqueteroId: origen?.pagoBanqueteroId ?? null,
      destino: input.destino,
      // Sin folio heredado, el default de la base toma el siguiente de la serie.
      ...(origen?.folio != null ? { folio: origen.folio } : folioPapel != null ? { folio: folioPapel } : {}),
      folioLetra: origen?.folioLetra ?? null,
    },
  });
  if (folioPapel != null) await subirSecuenciaSobre(db, folioPapel);

  // Un cobro a la cuenta del punto de venta no toca nada de la renta: ni
  // conceptos, ni hitos, ni estatus. Solo su bitácora y la foto del histórico.
  if (input.destino === 'cargos') {
    await logActivity(db, {
      quoteId, tipo: 'pago',
      descripcion: descripcionPagoCargos(payment.folio, input.monto, describirFormasPago(payment)),
      meta: { paymentId: payment.id, folio: payment.folio, monto: input.monto, destino: 'cargos', metodo, formas },
      actorId: actor.id,
    });
    await archivarEvento(db, quoteId);
    const { estadoCuenta } = await loadEstadoCuenta(db, quote);
    return { payment, estadoCuenta, nuevoEstatus: null };
  }

  // El concepto se DEDUCE del saldo, no de lo capturado: registrar el pago mueve
  // el acumulado, así que se reclasifica antes de anotar la bitácora — el rastro
  // tiene que decir el concepto con el que el pago quedó, no el que se tecleó.
  const reclasificado = await reclasificarConceptos(db, quote, {
    actorId: actor.id,
    salvo: payment.id,
  });
  let estadoCuenta = reclasificado.estadoCuenta;
  const conceptoEfectivo =
    reclasificado.cambios.find((c) => c.paymentId === payment.id)?.a ?? input.concepto;

  await logActivity(db, {
    quoteId, tipo: 'pago',
    descripcion: `Pago ${formatFolio(payment.folio, payment.folioLetra)} ${conceptoEfectivo} $${input.monto} (${describirFormasPago(payment)})`,
    meta: {
      paymentId: payment.id, folio: payment.folio, monto: input.monto, concepto: conceptoEfectivo, metodo, formas,
      // Lo tecleado se guarda solo cuando la deducción no le hizo caso: es el
      // rastro de que el número, no la captura, decidió el concepto.
      ...(conceptoEfectivo === input.concepto ? {} : { conceptoCapturado: input.concepto }),
    },
    actorId: actor.id,
  });

  // Auto-avance de estatus: si el acumulado cruza un hito, el estatus sube solo
  // (nunca baja). No requiere confirmación manual.
  let nuevoEstatus: PaymentStatus | null = null;
  if (esUpgrade(quote.status, estadoCuenta.sugerido)) {
    nuevoEstatus = estadoCuenta.sugerido!;
    await db.quote.update({ where: { id: quoteId }, data: { status: nuevoEstatus } });
    await logActivity(db, {
      quoteId, tipo: 'estatus',
      descripcion: `Estatus: ${quote.status} → ${nuevoEstatus} (automático por pago)`,
      meta: { de: quote.status, a: nuevoEstatus, auto: true }, actorId: actor.id,
    });
    // Recalcular con el nuevo estatus para que 'desfase' quede coherente.
    ({ estadoCuenta } = await loadEstadoCuenta(db, { ...quote, status: nuevoEstatus }));
  }

  // Si el evento ya pasó, su foto del histórico se pone al día con este pago.
  // El diseño lo pide explícitamente: los pagos se siguen registrando hasta
  // liquidar y la parte financiera de la foto se actualiza con cada uno. Sin
  // esto habría que esperar al siguiente reinicio del contenedor para que el
  // histórico dijera la verdad.
  await archivarEvento(db, quoteId);

  // El pago se devuelve con el concepto EFECTIVO, no con el tecleado: quien lo
  // imprima (el panel, el recibo) no debe ver el que la deducción descartó.
  return { payment: { ...payment, concepto: conceptoEfectivo }, estadoCuenta, nuevoEstatus };
}

export async function anularPayment(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  motivo: string,
  actor: Actor,
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede anular pagos');
  const quote = await findOwnedQuote(db, quoteId, actor);
  const payment = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!payment) throw new QuoteError(404, 'Pago no encontrado');
  if (payment.anuladoAt) throw new QuoteError(409, 'El pago ya está anulado');

  await db.payment.update({
    where: { id: paymentId },
    data: { anuladoAt: new Date(), anuladoById: actor.id, motivoAnulacion: motivo },
  });
  await logActivity(db, {
    quoteId, tipo: 'pagoAnulado',
    descripcion: `Pago ${formatFolio(payment.folio, payment.folioLetra)} anulado $${payment.monto}: ${motivo}`,
    meta: { paymentId, motivo }, actorId: actor.id,
  });

  // Anular baja el acumulado, así que los pagos POSTERIORES pueden dejar de ser
  // lo que eran: el que cerraba la cuenta ya no la cierra. Se reclasifican todos
  // y la cadena queda en la bitácora.
  const { estadoCuenta, cambios } = await reclasificarConceptos(db, quote, { actorId: actor.id });
  // Anular también mueve el dinero del evento: la foto tiene que reflejarlo.
  await archivarEvento(db, quoteId);
  return { estadoCuenta, cambios };
}

/**
 * Corrige a mano el concepto de un pago.
 *
 * Lo puede hacer **ventas sobre lo suyo**: es un error de captura, no un
 * movimiento de dinero (a diferencia de anular, que sí es de admin).
 *
 * La corrección se guarda en `conceptoManual` y el concepto efectivo se vuelve a
 * deducir: **la regla del finiquito gana siempre**, en los dos sentidos. Si el
 * pago cierra la cuenta queda como finiquito aunque se pida otra cosa, y marcarlo
 * "finiquito" a mano no lo convierte en uno si no la cierra. Por eso la respuesta
 * trae el concepto con el que quedó, que puede no ser el que se pidió.
 */
export async function editarConcepto(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  rawInput: unknown,
  actor: Actor,
) {
  const quote = await findOwnedQuote(db, quoteId, actor);
  const input = conceptoSchema.parse(rawInput);
  const pago = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!pago) throw new QuoteError(404, 'Pago no encontrado');
  // Un pago anulado es evidencia de auditoría: se conserva con la etiqueta con la
  // que quedó y no se reetiqueta.
  if (pago.anuladoAt) throw new QuoteError(409, 'El pago está anulado: su concepto ya no se corrige.');

  await db.payment.update({ where: { id: paymentId }, data: { conceptoManual: input.concepto } });

  const { estadoCuenta, payments, cambios } = await reclasificarConceptos(db, quote, {
    actorId: actor.id,
    salvo: paymentId,
  });
  const efectivo = payments.find((p) => p.id === paymentId)?.concepto ?? pago.concepto;

  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion:
      `Concepto del pago ${formatFolio(pago.folio, pago.folioLetra)}: ${pago.concepto} → ${efectivo}` +
      (efectivo === input.concepto ? '' : ` (se pidió ${input.concepto}; manda el saldo)`),
    meta: { paymentId, folio: pago.folio, de: pago.concepto, a: efectivo, pedido: input.concepto },
    actorId: actor.id,
  });

  return { concepto: efectivo, pedido: input.concepto, estadoCuenta, cambios };
}

/**
 * Corregir o completar las notas de un pago. Como el concepto, lo puede hacer
 * ventas sobre lo suyo: no mueve dinero. También en un pago anulado, porque ahí
 * es justo donde más falta explicar qué pasó. Queda en la bitácora.
 */
export async function editarNotasPago(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  rawInput: unknown,
  actor: Actor,
) {
  await findOwnedQuote(db, quoteId, actor);
  const { notas } = editarNotasSchema.parse(rawInput);
  const pago = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!pago) throw new QuoteError(404, 'Pago no encontrado');
  const nuevas = notaONull(notas);
  if (nuevas === pago.notas) return { notas: nuevas };
  await db.payment.update({ where: { id: paymentId }, data: { notas: nuevas } });
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Notas del pago ${formatFolio(pago.folio, pago.folioLetra)}: ${nuevas ?? '(sin notas)'}`,
    meta: { paymentId, folio: pago.folio, antes: pago.notas, despues: nuevas },
    actorId: actor.id,
  });
  return { notas: nuevas };
}

/**
 * Reabre la facturación de un pago cuyo mes ya cerró. Solo admin.
 *
 * Existe porque los CFDI se cancelan y se reemiten: sin esta salida habría que
 * crear un cliente nuevo para corregir un RFC mal capturado. No reabre un pago
 * que YA se facturó — para eso primero hay que cancelar el CFDI.
 */
export async function desbloquearFactura(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  actor: Actor,
) {
  if (actor.role !== 'admin') {
    throw new QuoteError(403, 'Solo un admin puede desbloquear la facturación de un pago.');
  }
  // Igual que al anular: una cotización en la papelera es evidencia de auditoría
  // y no admite escrituras, tampoco por esta puerta.
  await findOwnedQuote(db, quoteId, actor);
  const pago = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!pago) throw new QuoteError(404, 'Pago no encontrado');
  if (pago.facturadoAt) {
    throw new QuoteError(409, 'Este pago ya tiene CFDI. Cancélalo antes de reabrirlo.');
  }
  const actualizado = await db.payment.update({
    where: { id: paymentId },
    data: { desbloqueoAt: new Date() },
  });
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Desbloqueo de facturación del pago ${formatFolio(pago.folio, pago.folioLetra)}`,
    meta: { paymentId, folio: pago.folio },
    actorId: actor.id,
  });
  const est = estadoFacturaPago(actualizado, hoyCivilMexico());
  return { payment: actualizado, facturable: est.facturable };
}

export const marcarFacturadoSchema = z.object({
  facturaUuid: z.string().uuid().nullish(),
});

/**
 * Sella un pago como facturado. Mientras no exista el PAC, este es el único
 * disparador del candado de datos fiscales, y por eso es de admin.
 *
 * Limpia `desbloqueoAt`: el desbloqueo era el permiso para timbrar fuera de
 * plazo, y una vez timbrado ya no aplica a nada.
 */
export async function marcarFacturado(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  input: z.infer<typeof marcarFacturadoSchema>,
  actor: Actor,
) {
  if (actor.role !== 'admin') {
    throw new QuoteError(403, 'Solo un admin puede marcar un pago como facturado.');
  }
  // Igual que al anular: una cotización en la papelera es evidencia de auditoría
  // y no admite escrituras, tampoco por esta puerta.
  await findOwnedQuote(db, quoteId, actor);
  const pago = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!pago) throw new QuoteError(404, 'Pago no encontrado');
  if (pago.anuladoAt) throw new QuoteError(409, 'El pago está anulado.');
  if (pago.facturadoAt) throw new QuoteError(409, 'Este pago ya está facturado.');

  const actualizado = await db.payment.update({
    where: { id: paymentId },
    data: { facturadoAt: new Date(), facturaUuid: input.facturaUuid ?? null, desbloqueoAt: null },
  });
  await logActivity(db, {
    quoteId,
    tipo: 'factura',
    descripcion: `Pago ${formatFolio(pago.folio, pago.folioLetra)} marcado como facturado${input.facturaUuid ? ` (UUID ${input.facturaUuid})` : ''}`,
    meta: { paymentId, folio: pago.folio, facturaUuid: input.facturaUuid ?? null },
    actorId: actor.id,
  });
  return actualizado;
}

export interface ComprobanteData {
  data: Buffer;
  mime: string;
}

/** Comprobante de un pago para la vendedora/admin (respeta ownership). */
export async function loadComprobanteInterno(
  db: PrismaClient,
  storage: ComprobanteStorage,
  quoteId: string,
  paymentId: string,
  actor: Actor,
): Promise<ComprobanteData | null> {
  const quote = await db.quote.findFirst({ where: { id: quoteId, ...ownershipWhere(actor) }, select: { id: true } });
  if (!quote) return null;
  const payment = await db.payment.findFirst({
    where: { id: paymentId, quoteId },
    select: { comprobanteKey: true, comprobanteMime: true },
  });
  if (!payment?.comprobanteKey) return null;
  const data = await storage.load(payment.comprobanteKey);
  if (!data) return null;
  return { data, mime: payment.comprobanteMime ?? 'application/octet-stream' };
}

/** Comprobante para el cliente vía token público (valida pertenencia y no anulado). */
export async function loadComprobantePublico(
  db: PrismaClient,
  storage: ComprobanteStorage,
  token: string,
  paymentId: string,
): Promise<ComprobanteData | null> {
  const quote = await db.quote.findUnique({ where: { publicToken: token }, select: { id: true } });
  if (!quote) return null;
  const payment = await db.payment.findFirst({
    where: { id: paymentId, quoteId: quote.id, anuladoAt: null },
    select: { comprobanteKey: true, comprobanteMime: true },
  });
  if (!payment?.comprobanteKey) return null;
  const data = await storage.load(payment.comprobanteKey);
  if (!data) return null;
  return { data, mime: payment.comprobanteMime ?? 'application/octet-stream' };
}
