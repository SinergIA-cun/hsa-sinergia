import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { metodoCapturaSchema, formasPagoSchema, describirFormasPago, formatFolio } from '@hsa/shared';
import { QuoteError, ownershipWhere, assertNotTrashed, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import { validarCobroDeCargos } from '../cargos/service.js';
import { resolverOError } from './service.js';
import { folioPapelSchema, subirSecuenciaSobre, validarFolioDePapel } from './folios.js';
import { ponerAlDia } from './estatus.js';

// Corregir y mover recibos desde el punto de venta. Desde que el BI y el punto de
// venta están enlazados, el BI ya no edita lo que mandó: los errores de captura
// se corrigen aquí (reunión del 5-oct-2026). Las dos operaciones mueven dinero,
// así que son de admin —como anular— y piden motivo, que queda en la bitácora.

const motivo = z.string().trim().min(3, 'Escribe el motivo (al menos 3 letras).').max(300);

export const corregirPagoSchema = z
  .object({
    monto: z.number().int().positive().optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    metodo: metodoCapturaSchema.optional(),
    formas: formasPagoSchema.optional(),
    referencia: z.string().trim().max(120).nullish(),
    /** Corregir el número de la hoja de papel (error de dedo). */
    folioPapel: folioPapelSchema.optional(),
    motivo,
  })
  .refine((o) => ['monto', 'fecha', 'metodo', 'formas', 'referencia', 'folioPapel'].some((k) => o[k as keyof typeof o] !== undefined), {
    message: 'No hay nada que corregir',
  });

export const moverPagoSchema = z.object({
  /** El código del evento al que va (el vigente o uno anterior) o su id. */
  destino: z.string().trim().min(1),
  motivo,
});

/** El pago editable de un evento propio, o el error que explica por qué no. */
async function pagoCorregible(db: PrismaClient, quoteId: string, paymentId: string, actor: Actor) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede corregir o mover un pago.');
  const quote = await db.quote.findFirst({ where: { id: quoteId, ...ownershipWhere(actor) } });
  if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(quote);
  const pago = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!pago) throw new QuoteError(404, 'Pago no encontrado');
  if (pago.anuladoAt) throw new QuoteError(409, 'El pago está anulado: ya no se corrige ni se mueve.');
  if (pago.facturadoAt) throw new QuoteError(409, 'El pago ya tiene CFDI: cancélalo antes de corregir o mover el pago.');
  // Un pago que salió de repartir un depósito de banquetero (o de convertir un
  // abono) es una parte de esa entrada: se corrige desde ella, o se anula y se
  // vuelve a repartir. Cambiarlo suelto descuadraría el depósito.
  if (pago.pagoBanqueteroId) {
    throw new QuoteError(409, 'Este pago salió de un depósito del banquetero: corrígelo desde su cuenta (anula y vuelve a repartir).');
  }
  return { quote, pago };
}

/**
 * Corrige un recibo ya registrado: monto, fecha, forma de pago (dividirla),
 * referencia o el folio de papel. El folio de la serie no cambia —es el mismo
 * recibo— salvo que se corrija el de papel.
 */
export async function corregirPago(db: PrismaClient, quoteId: string, paymentId: string, rawInput: unknown, actor: Actor) {
  const { quote, pago } = await pagoCorregible(db, quoteId, paymentId, actor);
  const input = corregirPagoSchema.parse(rawInput);
  const monto = input.monto ?? pago.monto;

  // La forma de pago: si se manda, se valida contra el monto (nuevo o el de antes).
  let metodo = pago.metodo;
  let formas = pago.formas;
  if (input.formas !== undefined || input.metodo !== undefined) {
    const r = resolverOError({ monto, metodo: input.metodo, formas: input.formas });
    metodo = r.metodo;
    formas = r.formas as typeof formas;
  } else if (input.monto !== undefined) {
    // Un pago de una sola forma se lleva el monto nuevo; uno dividido tiene que
    // decir cómo quedan sus partes.
    if ((Array.isArray(pago.formas) && pago.formas.length > 1) || pago.metodo === 'mixto') {
      throw new QuoteError(400, 'El pago está dividido: al cambiar el monto, manda también cómo quedan las partes.');
    }
    const r = resolverOError({ monto, metodo: pago.metodo as Parameters<typeof resolverOError>[0]['metodo'] });
    metodo = r.metodo;
    formas = r.formas as typeof formas;
  }
  if (input.folioPapel != null && input.folioPapel !== pago.folio) await validarFolioDePapel(db, input.folioPapel, actor);
  if (pago.destino === 'cargos' && monto > pago.monto) await validarCobroDeCargos(db, quote, monto - pago.monto);

  const antes = { monto: pago.monto, fecha: pago.fecha.toISOString().slice(0, 10), formas: describirFormasPago(pago), referencia: pago.referencia, folio: pago.folio };
  const actualizado = await db.payment.update({
    where: { id: paymentId },
    data: {
      monto,
      metodo,
      formas: formas ?? undefined,
      ...(input.fecha ? { fecha: new Date(`${input.fecha}T00:00:00.000Z`) } : {}),
      ...(input.referencia !== undefined ? { referencia: input.referencia || null } : {}),
      ...(input.folioPapel != null ? { folio: input.folioPapel, folioLetra: null } : {}),
    },
  });
  if (input.folioPapel != null) await subirSecuenciaSobre(db, input.folioPapel);
  const despues = {
    monto: actualizado.monto,
    fecha: actualizado.fecha.toISOString().slice(0, 10),
    formas: describirFormasPago(actualizado),
    referencia: actualizado.referencia,
    folio: actualizado.folio,
  };
  const cambios = (Object.keys(antes) as (keyof typeof antes)[]).filter((k) => antes[k] !== despues[k]);
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Pago ${formatFolio(pago.folio, pago.folioLetra)} corregido (${cambios.join(', ') || 'sin cambios'}): ${input.motivo}`,
    meta: { paymentId, correccion: true, motivo: input.motivo, antes, despues },
    actorId: actor.id,
  });
  if (pago.destino === 'evento') await ponerAlDia(db, quoteId, actor.id, 'se corrigió un pago');
  return { payment: actualizado };
}

/** Un evento por su código (vigente o anterior) o su id, de los que el actor puede ver. */
export async function eventoPorCodigo(db: PrismaClient, codigo: string, actor: Actor) {
  const c = codigo.trim();
  const porCodigo = await db.codigoEvento.findFirst({
    where: { codigo: { equals: c, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    select: { quoteId: true },
  });
  const ids = [c, porCodigo?.quoteId].filter((x): x is string => !!x);
  return db.quote.findFirst({
    where: {
      ...ownershipWhere(actor),
      deletedAt: null,
      OR: [{ id: { in: ids } }, { etiqueta: { equals: c, mode: 'insensitive' } }],
    },
    select: { id: true, etiqueta: true, fechaEvento: true, status: true, client: { select: { nombre: true } } },
  });
}

/**
 * Mueve un pago a otro evento: el recibo se capturó en el evento equivocado. Es
 * el MISMO recibo (mismo folio, monto y forma); cambia el evento. Los dos eventos
 * se ponen al día y los dos dejan el rastro en su bitácora.
 */
export async function moverPago(db: PrismaClient, quoteId: string, paymentId: string, rawInput: unknown, actor: Actor) {
  const { pago } = await pagoCorregible(db, quoteId, paymentId, actor);
  const input = moverPagoSchema.parse(rawInput);
  const destino = await eventoPorCodigo(db, input.destino, actor);
  if (!destino) throw new QuoteError(404, `No hay un evento con el código ${input.destino}.`);
  if (destino.id === quoteId) throw new QuoteError(400, 'El pago ya está en ese evento.');
  if (destino.status === 'cancelada') throw new QuoteError(409, 'Ese evento está cancelado: no se le pasan pagos.');
  if (pago.destino === 'cargos') await validarCobroDeCargos(db, destino, pago.monto);

  const origen = await db.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { etiqueta: true } });
  await db.payment.update({ where: { id: paymentId }, data: { quoteId: destino.id } });
  const folio = formatFolio(pago.folio, pago.folioLetra);
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Pago ${folio} $${pago.monto} movido al evento ${destino.etiqueta}: ${input.motivo}`,
    meta: { paymentId, movidoA: destino.id, codigoDestino: destino.etiqueta, monto: pago.monto, motivo: input.motivo },
    actorId: actor.id,
  });
  await logActivity(db, {
    quoteId: destino.id,
    tipo: 'pago',
    descripcion: `Pago ${folio} $${pago.monto} recibido del evento ${origen.etiqueta}: ${input.motivo}`,
    meta: { paymentId, folio: pago.folio, monto: pago.monto, movidoDe: quoteId, codigoOrigen: origen.etiqueta, motivo: input.motivo },
    actorId: actor.id,
  });
  if (pago.destino === 'evento') {
    await ponerAlDia(db, quoteId, actor.id, 'salió un pago a otro evento');
    await ponerAlDia(db, destino.id, actor.id, 'llegó un pago de otro evento');
  }
  return { destino: { id: destino.id, codigo: destino.etiqueta } };
}

/** `I 4201`, `4201`, `i4201`, `I 5340-B`, `5340b` → { folio, letra }. */
export function leerFolio(texto: string): { folio: number; letra: string | null } | null {
  const m = /^\s*I?\s*(\d{1,9})\s*-?\s*([A-Z])?\s*$/i.exec(texto);
  if (!m) return null;
  return { folio: Number(m[1]), letra: m[2]?.toUpperCase() ?? null };
}

/**
 * Todo el dinero con ese folio: pagos de eventos (también los anulados, que se
 * marcan), depósitos de banquetero y abonos de apartados. Un depósito repartido
 * trae todos sus pagos (A, B, C…) salvo que se pida una letra.
 */
export async function buscarRecibos(db: PrismaClient, texto: string, actor: Actor) {
  const leido = leerFolio(texto);
  if (!leido) throw new QuoteError(400, 'Escribe un folio, por ejemplo I 4201 o 5340-B.');
  const { folio, letra } = leido;
  const [pagos, depositos, abonos] = await Promise.all([
    db.payment.findMany({
      where: { folio, ...(letra ? { folioLetra: letra } : {}), quote: { deletedAt: null, ...ownershipWhere(actor) } },
      include: { quote: { select: { id: true, etiqueta: true, fechaEvento: true, client: { select: { nombre: true } } } } },
      orderBy: [{ folioLetra: 'asc' }, { createdAt: 'asc' }],
    }),
    letra ? [] : db.pagoBanquetero.findMany({ where: { folio }, include: { banquetero: { select: { id: true, nombre: true } } } }),
    letra ? [] : db.abonoApartado.findMany({ where: { folio }, include: { apartado: { select: { id: true, fechaEvento: true } } } }),
  ]);
  return {
    folio: formatFolio(folio, letra),
    resultados: [
      ...pagos.map((p) => ({
        tipo: 'pago' as const,
        id: p.id,
        folio: formatFolio(p.folio, p.folioLetra),
        monto: p.monto,
        fecha: p.fecha.toISOString().slice(0, 10),
        formas: describirFormasPago(p),
        concepto: p.concepto,
        destino: p.destino,
        anulado: p.anuladoAt != null,
        evento: { id: p.quote.id, codigo: p.quote.etiqueta, cliente: p.quote.client?.nombre ?? null, fecha: p.quote.fechaEvento.toISOString().slice(0, 10) },
      })),
      ...depositos.map((d) => ({
        tipo: 'deposito' as const,
        id: d.id,
        folio: formatFolio(d.folio ?? folio),
        monto: d.monto,
        fecha: d.fecha.toISOString().slice(0, 10),
        anulado: d.anuladoAt != null,
        banquetero: d.banquetero,
      })),
      ...abonos.map((a) => ({
        tipo: 'abono' as const,
        id: a.id,
        folio: formatFolio(a.folio ?? folio, a.folioLetra),
        monto: a.monto,
        fecha: a.fecha.toISOString().slice(0, 10),
        anulado: a.anuladoAt != null,
        apartado: { id: a.apartado.id, fecha: a.apartado.fechaEvento.toISOString().slice(0, 10) },
      })),
    ],
  };
}
