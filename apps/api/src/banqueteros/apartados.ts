import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { hoyCivilMexico } from '@hsa/shared';
import { QuoteError, createQuote, type Actor } from '../quotes/service.js';
import { getAvailability } from '../availability/service.js';
import { registerPayment } from '../payments/service.js';
import type { ComprobanteStorage } from '../payments/storage.js';

/**
 * Apartar una fecha SIN precio.
 *
 * El caso 3 del dueño: los banqueteros son los que más graduaciones venden,
 * piden fechas muy adelantadas —hoy 2028— y pagan la fecha sin que los precios
 * existan todavía. Hoy no cabe: `createQuote` exige un catálogo y calcula un
 * total.
 *
 * Un apartado bloquea la disponibilidad igual que un evento comprometido (es
 * dinero real sobre una fecha) pero **no tiene total**: no es una venta cerrada y
 * no aparece en ningún reporte de ingreso comprometido, que siguen leyendo
 * `Quote`.
 *
 * Este archivo NO toca el motor de precios: un apartado sin precio no pasa por
 * él, y una cotización convertida pasa exactamente como cualquier otra.
 */

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const apartadoSchema = z
  .object({
    fechaEvento: fechaISO,
    spaceIds: z.array(z.string().min(1)).min(1),
    /** El catálogo con precio garantizado, si se negoció uno. */
    priceListId: z.string().min(1).nullish(),
    // `int`: el depósito se captura. Prisma trunca los flotantes al escribir en
    // una columna `Int` sin avisar, así que un decimal se rechaza, no se redondea.
    deposito: z.number().int().nonnegative().default(0),
    depositoMetodo: z.enum(['efectivo', 'transferencia', 'tarjeta']).nullish(),
    /** Cuándo se RECIBIÓ el depósito (no cuándo se capturó ni cuándo se convierte). */
    depositoFecha: fechaISO.nullish(),
    vence: fechaISO,
    nota: z.string().max(500).nullish(),
    /**
     * Apartar sobre una fecha ya comprometida AVISA, no bloquea: el mismo trato
     * que los empalmes. Sin `confirmar` la respuesta es 409 con el detalle del
     * choque; con `confirmar` procede y el empalme queda a la vista de todos.
     */
    confirmar: z.boolean().default(false),
  })
  .refine((d) => d.deposito === 0 || (d.depositoMetodo != null && d.depositoFecha != null), {
    message: 'Un depósito necesita forma de pago y la fecha en que se recibió.',
    path: ['depositoMetodo'],
  });

export const cancelarApartadoSchema = z.object({ motivo: z.string().min(3) });

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const INCLUDE = {
  banquetero: { select: { id: true, nombre: true, telefono: true } },
  priceList: { select: { id: true, nombre: true, anio: true } },
  quote: { select: { id: true, codigo: true, total: true, status: true } },
} as const;

/** ¿Este apartado sigue bloqueando su fecha? Pura, para que el "hoy" se pueda fijar. */
export function apartadoVivo(
  a: { canceladoAt: Date | null; quoteId: string | null; vence: Date },
  hoy: Date = hoyCivilMexico(),
): boolean {
  return a.canceladoAt == null && a.quoteId == null && a.vence.getTime() >= hoy.getTime();
}

export async function crearApartado(
  db: PrismaClient,
  banqueteroId: string,
  rawInput: unknown,
  actor: Actor,
) {
  const input = apartadoSchema.parse(rawInput);
  const banquetero = await db.banquetero.findUnique({ where: { id: banqueteroId }, select: { id: true } });
  if (!banquetero) throw new QuoteError(404, 'Banquetero no encontrado');
  if (input.priceListId) {
    const cat = await db.priceList.findUnique({ where: { id: input.priceListId }, select: { id: true } });
    if (!cat) throw new QuoteError(400, 'El catálogo elegido no existe.');
  }

  const hoy = hoyCivilMexico();
  // Un apartado que nace vencido no bloquea nada: aceptarlo en silencio sería
  // guardar un registro que no hace lo único que se le pide.
  if (dia(input.vence).getTime() < hoy.getTime()) {
    throw new QuoteError(400, 'El vencimiento del apartado ya pasó.');
  }

  // Mismo trato que los empalmes: avisa, no bloquea. Sin `confirmar` no se
  // aparta a ciegas sobre una fecha comprometida; con él, procede.
  const disp = await getAvailability(db, input.fechaEvento, input.spaceIds);
  const choques = disp.spaces.filter((s) => s.level === 'bloqueada');
  if (choques.length > 0 && !input.confirmar) {
    throw new QuoteError(
      409,
      `${choques.map((s) => s.nombre).join(', ')} ya está comprometido el ${input.fechaEvento}. ` +
        'Confirma si de todos modos quieres apartar esa fecha.',
    );
  }

  const apartado = await db.apartadoFecha.create({
    data: {
      banqueteroId,
      fechaEvento: dia(input.fechaEvento),
      spaceIds: input.spaceIds,
      priceListId: input.priceListId ?? null,
      deposito: input.deposito,
      depositoMetodo: input.depositoMetodo ?? null,
      depositoFecha: input.depositoFecha ? dia(input.depositoFecha) : null,
      vence: dia(input.vence),
      nota: input.nota ?? null,
      createdById: actor.id,
    },
    include: INCLUDE,
  });
  return { apartado, avisos: choques.map((s) => ({ spaceId: s.spaceId, nombre: s.nombre })) };
}

/** Los apartados de un banquetero, del más próximo al más lejano. */
export async function listarApartados(
  db: PrismaClient,
  banqueteroId: string,
  opts: { hoy?: Date } = {},
) {
  const apartados = await db.apartadoFecha.findMany({
    where: { banqueteroId },
    include: INCLUDE,
    orderBy: { fechaEvento: 'asc' },
  });
  const hoy = opts.hoy ?? hoyCivilMexico();
  return apartados.map((a) => ({
    ...a,
    vivo: apartadoVivo(a, hoy),
    vencido: a.canceladoAt == null && a.quoteId == null && a.vence.getTime() < hoy.getTime(),
  }));
}

/**
 * Cancela un apartado: la fecha se libera. Solo admin — es una decisión sobre
 * inventario de fechas y sobre un depósito que ya entró.
 */
export async function cancelarApartado(
  db: PrismaClient,
  apartadoId: string,
  rawInput: unknown,
  actor: Actor,
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede cancelar un apartado.');
  const { motivo } = cancelarApartadoSchema.parse(rawInput);
  const apartado = await db.apartadoFecha.findUnique({ where: { id: apartadoId } });
  if (!apartado) throw new QuoteError(404, 'Apartado no encontrado');
  if (apartado.canceladoAt) throw new QuoteError(409, 'El apartado ya está cancelado');
  if (apartado.quoteId) {
    throw new QuoteError(409, 'Este apartado ya se convirtió en cotización: cancela la cotización.');
  }
  return db.apartadoFecha.update({
    where: { id: apartadoId },
    data: { canceladoAt: new Date(), canceladoById: actor.id, motivoCancelacion: motivo },
    include: INCLUDE,
  });
}

/**
 * Convierte un apartado en cotización.
 *
 * El cuerpo es el de crear una cotización normal (tipo de evento, invitados,
 * cliente, paquete…): eso es justamente lo que el apartado no tenía. Lo que NO se
 * acepta del cuerpo es la fecha, los espacios ni el banquetero — esos vienen del
 * apartado, que es lo que se pagó.
 *
 * Hereda su catálogo si lo tiene (el precio garantizado) y el activo si no. Y el
 * depósito pasa como pago de la cotización nueva **con la fecha en que se
 * recibió**, no con la de la conversión: el candado del Plan C corre por pago y el
 * SAT exige facturar el ingreso en el mes en que entró.
 */
export async function convertirApartado(
  db: PrismaClient,
  storage: ComprobanteStorage,
  apartadoId: string,
  rawInput: unknown,
  actor: Actor,
) {
  const apartado = await db.apartadoFecha.findUnique({ where: { id: apartadoId } });
  if (!apartado) throw new QuoteError(404, 'Apartado no encontrado');
  if (apartado.quoteId) throw new QuoteError(409, 'Este apartado ya se convirtió en cotización.');
  if (apartado.canceladoAt) throw new QuoteError(409, 'El apartado está cancelado.');
  // Un depósito sin forma de pago o sin fecha de recepción no se puede convertir en
  // `Payment`: se para aquí en vez de crear la cotización y perder el pago en
  // silencio. El esquema de captura ya los exige; esto cubre las filas viejas.
  if (apartado.deposito > 0 && (!apartado.depositoMetodo || !apartado.depositoFecha)) {
    throw new QuoteError(
      409,
      'El depósito del apartado no tiene forma de pago o fecha de recepción: complétalos antes de convertir.',
    );
  }

  const body = (rawInput ?? {}) as Record<string, unknown>;
  const quote = await createQuote(
    db,
    {
      ...body,
      fecha: apartado.fechaEvento.toISOString().slice(0, 10),
      spaceIds: apartado.spaceIds,
      banqueteroId: apartado.banqueteroId,
    },
    actor,
    {
      priceListId: apartado.priceListId ?? undefined,
      // Su propio apartado no puede bloquearle la fecha.
      excludeApartadoId: apartado.id,
    },
  );

  await db.apartadoFecha.update({ where: { id: apartadoId }, data: { quoteId: quote.id } });

  let pago = null;
  if (apartado.deposito > 0 && apartado.depositoMetodo && apartado.depositoFecha) {
    const res = await registerPayment(
      db,
      storage,
      quote.id,
      {
        monto: apartado.deposito,
        metodo: apartado.depositoMetodo,
        concepto: 'aCuenta',
        // La fecha del DEPÓSITO, no la de la conversión.
        fecha: apartado.depositoFecha.toISOString().slice(0, 10),
        referencia: `Apartado ${apartado.id}`,
      },
      actor,
    );
    pago = { id: res.payment.id, folio: res.payment.folio, monto: res.payment.monto, fecha: res.payment.fecha };
  }

  const actualizado = await db.apartadoFecha.findUniqueOrThrow({
    where: { id: apartadoId },
    include: INCLUDE,
  });
  return { apartado: actualizado, quote, pago };
}
