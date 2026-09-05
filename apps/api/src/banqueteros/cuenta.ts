import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { QuoteError, ownershipWhere, assertNotTrashed, type Actor } from '../quotes/service.js';
import { registerPayment, anularPayment } from '../payments/service.js';
import type { ComprobanteStorage } from '../payments/storage.js';
import { abonarDesdeDeposito } from './abonos.js';

/**
 * La cuenta corriente del banquetero.
 *
 * El dinero entra a su cuenta ANTES de que se sepa a qué eventos va (decisión 3
 * del dueño: "puede hacer un pago por 323,345 pesos y luego decirte cómo van
 * distribuidos"). El saldo sin asignar es un estado legítimo y visible.
 *
 * La pieza que hace que esto no rompa nada: **cada asignación genera un `Payment`
 * real en la cotización**, con su folio de recibo. El estado de cuenta, los hitos
 * del plan, el candado de facturación y el API del BI siguen leyendo `Payment` y
 * no se enteran. Lo único nuevo es `Payment.pagoBanqueteroId`, la liga al
 * depósito madre. NO hay una tabla paralela de pagos: eso costaría los folios,
 * los hitos y el candado fiscal de un golpe.
 */

/**
 * Los montos se capturan, no se calculan: `int` rechaza los decimales en vez de
 * redondearlos. Prisma TRUNCA los flotantes del lado del cliente al escribir en
 * una columna `Int` (55000.9 → 55000) sin avisar, así que un `z.number()` a secas
 * perdería dinero en silencio.
 */
const montoCapturado = z.number().int().positive();

export const depositoSchema = z.object({
  monto: montoCapturado,
  metodo: z.enum(['efectivo', 'transferencia', 'tarjeta']),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referencia: z.string().max(120).optional(),
});

export const asignarSchema = z
  .object({
    /**
     * El reparto completo en una sola instrucción, que es como llega de verdad:
     * "55,000 al evento A, 55,000 al B, el resto al C". Se valida TODO antes de
     * escribir nada: un reparto que se pasa del saldo no debe dejar dos pagos
     * hechos y el tercero rechazado.
     */
    asignaciones: z
      .array(z.object({ quoteId: z.string().min(1), monto: montoCapturado }))
      .default([]),
    /**
     * Y a sus fechas apartadas, que todavía no son eventos.
     *
     * Van en la MISMA instrucción y no en una ruta aparte porque son el mismo
     * dinero repartiéndose: un banquetero dice "de esos 300 mil, 100 al evento de
     * mayo y 200 a la fecha de 2029". Dos pantallas para eso serían dos maneras
     * de gastarse el mismo saldo sin que ninguna vea a la otra.
     */
    apartados: z
      .array(z.object({ apartadoId: z.string().min(1), monto: montoCapturado }))
      .default([]),
  })
  .refine((d) => d.asignaciones.length + d.apartados.length > 0, {
    message: 'El reparto tiene que llevar al menos un destino.',
  });

export const anularDepositoSchema = z.object({ motivo: z.string().min(3) });

/** Un movimiento contra el depósito, visto por el cálculo del saldo. */
export interface MovimientoLite {
  monto: number;
  anuladoAt: Date | null;
}

/**
 * Saldo sin asignar de un depósito: lo depositado menos lo repartido que sigue
 * vivo. Función pura para poder probarla sin base.
 *
 * Un depósito anulado no tiene saldo que repartir; una asignación anulada
 * devuelve su monto al saldo, que es exactamente el camino de corrección que el
 * dueño necesita ("ese pago iba al evento C, no al B").
 */
export function saldoSinAsignar(
  deposito: { monto: number; anuladoAt: Date | null },
  asignaciones: MovimientoLite[],
  /**
   * Los abonos a fechas apartadas que salieron de este depósito.
   *
   * Solo cuentan los que **todavía no se convirtieron en pago**: al convertir el
   * apartado, el abono se vuelve un `Payment` que ya aparece en `asignaciones`.
   * Contar los dos restaría el mismo dinero dos veces y el saldo saldría corto.
   */
  abonosApartado: (MovimientoLite & { paymentId?: string | null })[] = [],
): number {
  if (deposito.anuladoAt) return 0;
  const asignado = asignaciones.filter((a) => a.anuladoAt == null).reduce((s, a) => s + a.monto, 0);
  const abonado = abonosApartado
    .filter((a) => a.anuladoAt == null && a.paymentId == null)
    .reduce((s, a) => s + a.monto, 0);
  return deposito.monto - asignado - abonado;
}

const CON_ASIGNACIONES = {
  // Los abonos a fechas apartadas que salieron de este depósito: cuentan contra
  // su saldo igual que las asignaciones a eventos.
  abonosApartado: {
    select: {
      id: true,
      monto: true,
      anuladoAt: true,
      paymentId: true,
      fecha: true,
      apartadoId: true,
      apartado: { select: { fechaEvento: true, spaceIds: true } },
    },
  },
  asignaciones: {
    select: {
      id: true,
      quoteId: true,
      monto: true,
      folio: true,
      fecha: true,
      concepto: true,
      anuladoAt: true,
      motivoAnulacion: true,
      quote: { select: { id: true, folio: true, etiqueta: true, client: { select: { nombre: true } } } },
    },
    orderBy: { folio: 'asc' },
  },
} as const;

async function cargarDeposito(db: PrismaClient, depositoId: string) {
  const deposito = await db.pagoBanquetero.findUnique({
    where: { id: depositoId },
    include: CON_ASIGNACIONES,
  });
  if (!deposito) throw new QuoteError(404, 'Depósito no encontrado');
  return deposito;
}

/** El depósito con su saldo ya calculado, que es lo que la interfaz consume. */
function conSaldo<
  T extends {
    monto: number;
    anuladoAt: Date | null;
    asignaciones: MovimientoLite[];
    abonosApartado?: (MovimientoLite & { paymentId?: string | null })[];
  },
>(d: T) {
  return { ...d, saldoSinAsignar: saldoSinAsignar(d, d.asignaciones, d.abonosApartado ?? []) };
}

/**
 * Registra un depósito a la cuenta del banquetero. Solo admin: es dinero que
 * entra a la hacienda sin destino todavía.
 */
export async function registrarDeposito(
  db: PrismaClient,
  storage: ComprobanteStorage,
  banqueteroId: string,
  rawInput: unknown,
  actor: Actor,
  file?: { data: Buffer; mime: string },
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede registrar depósitos.');
  const input = depositoSchema.parse(rawInput);
  const banquetero = await db.banquetero.findUnique({ where: { id: banqueteroId }, select: { id: true } });
  if (!banquetero) throw new QuoteError(404, 'Banquetero no encontrado');

  let comprobanteKey: string | null = null;
  let comprobanteMime: string | null = null;
  if (file) {
    const stored = await storage.save(file.data, file.mime);
    comprobanteKey = stored.key;
    comprobanteMime = stored.mime;
  }

  const deposito = await db.pagoBanquetero.create({
    data: {
      banqueteroId,
      monto: input.monto,
      metodo: input.metodo,
      // Día calendario a medianoche UTC, igual que `Payment.fecha`: es la fecha
      // que heredarán los pagos de sus asignaciones y el candado fiscal la compara
      // contra el día civil de México, que vive en ese mismo espacio.
      fecha: new Date(`${input.fecha}T00:00:00.000Z`),
      referencia: input.referencia ?? null,
      comprobanteKey,
      comprobanteMime,
      registradoById: actor.id,
    },
    include: CON_ASIGNACIONES,
  });
  return conSaldo(deposito);
}

/**
 * Reparte un depósito entre los eventos del banquetero.
 *
 * Cada renglón crea un `Payment` en su cotización por la vía normal
 * (`registerPayment`), así que hereda el folio, la deducción del concepto, la
 * reclasificación en cadena, la bitácora y el auto-avance de estatus.
 *
 * **La fecha del pago es la del DEPÓSITO, no la del reparto.** El SAT exige
 * facturar el ingreso en el mes en que se recibe: un depósito de marzo repartido
 * en mayo sigue siendo ingreso de marzo, y el candado del Plan C corre por pago.
 * Con la fecha del reparto se facturaría fuera de mes.
 */
export async function asignarDeposito(
  db: PrismaClient,
  storage: ComprobanteStorage,
  depositoId: string,
  rawInput: unknown,
  actor: Actor,
) {
  const input = asignarSchema.parse(rawInput);
  const deposito = await cargarDeposito(db, depositoId);
  if (deposito.anuladoAt) throw new QuoteError(409, 'El depósito está anulado: ya no se puede repartir.');

  // Todo se valida ANTES de escribir: un reparto que se pasa del saldo no debe
  // dejar los primeros pagos hechos y el último rechazado.
  const disponible = saldoSinAsignar(deposito, deposito.asignaciones, deposito.abonosApartado);
  const pedido =
    input.asignaciones.reduce((s, a) => s + a.monto, 0) +
    input.apartados.reduce((s, a) => s + a.monto, 0);
  if (pedido > disponible) {
    throw new QuoteError(
      409,
      `El reparto ($${pedido}) se pasa del saldo sin asignar ($${disponible}) de este depósito.`,
    );
  }

  const repetido = input.asignaciones.map((a) => a.quoteId).find((id, i, arr) => arr.indexOf(id) !== i);
  if (repetido) throw new QuoteError(400, 'Un mismo evento aparece dos veces en el reparto.');
  const apartadoRepetido = input.apartados
    .map((a) => a.apartadoId)
    .find((id, i, arr) => arr.indexOf(id) !== i);
  if (apartadoRepetido) {
    throw new QuoteError(400, 'Una misma fecha apartada aparece dos veces en el reparto.');
  }

  // Las fechas apartadas se validan igual que los eventos, y ANTES de escribir:
  // que existan, que sean de ESTE banquetero y que todavía puedan recibir dinero.
  for (const a of input.apartados) {
    const apartado = await db.apartadoFecha.findUnique({
      where: { id: a.apartadoId },
      select: { id: true, banqueteroId: true, quoteId: true, canceladoAt: true },
    });
    if (!apartado) throw new QuoteError(404, 'Fecha apartada no encontrada');
    if (apartado.banqueteroId !== deposito.banqueteroId) {
      throw new QuoteError(
        409,
        'Esa fecha apartada no es de este banquetero: su depósito no puede abonarla.',
      );
    }
    if (apartado.canceladoAt) {
      throw new QuoteError(409, 'Esa fecha apartada está cancelada: ya se liberó.');
    }
    if (apartado.quoteId) {
      throw new QuoteError(
        409,
        'Esa fecha apartada ya es una cotización: repártele como evento, no como apartado.',
      );
    }
  }

  for (const a of input.asignaciones) {
    // `ownershipWhere`: una vendedora reparte sobre lo suyo; el admin sobre todo.
    const quote = await db.quote.findFirst({
      where: { id: a.quoteId, ...ownershipWhere(actor) },
      select: { id: true, banqueteroId: true, deletedAt: true },
    });
    if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
    assertNotTrashed(quote);
    // Un depósito no puede pagar el evento de alguien más: el dinero es de este
    // banquetero y el estado de cuenta tiene que cuadrar por contraparte.
    if (quote.banqueteroId !== deposito.banqueteroId) {
      throw new QuoteError(409, 'Ese evento no es de este banquetero: su depósito no puede pagarlo.');
    }
  }

  const fechaDeposito = deposito.fecha.toISOString().slice(0, 10);
  const pagos = [];
  for (const a of input.asignaciones) {
    const { payment, nuevoEstatus } = await registerPayment(
      db,
      storage,
      a.quoteId,
      {
        monto: a.monto,
        metodo: deposito.metodo,
        // El concepto se DEDUCE del saldo del evento; 'aCuenta' es solo el
        // respaldo para las cotizaciones sin plan de pagos.
        concepto: 'aCuenta',
        fecha: fechaDeposito,
        referencia: deposito.referencia ?? undefined,
      },
      actor,
      undefined,
      {
        pagoBanqueteroId: deposito.id,
        // El comprobante del depósito es el comprobante de cada recibo que sale
        // de él: hay un solo movimiento bancario detrás de los tres pagos.
        comprobanteKey: deposito.comprobanteKey,
        comprobanteMime: deposito.comprobanteMime,
      },
    );
    pagos.push({
      quoteId: a.quoteId,
      paymentId: payment.id,
      folio: payment.folio,
      monto: payment.monto,
      fecha: payment.fecha,
      concepto: payment.concepto,
      nuevoEstatus,
    });
  }

  // Y los abonos a fechas apartadas. Van DESPUÉS de los pagos y con la misma
  // fecha del depósito: son el mismo dinero, solo que a un destino que todavía
  // no tiene precio.
  const abonos = [];
  for (const a of input.apartados) {
    const abono = await abonarDesdeDeposito(db, {
      apartadoId: a.apartadoId,
      depositoId: deposito.id,
      monto: a.monto,
      metodo: deposito.metodo,
      fechaDeposito: deposito.fecha,
      actorId: actor.id,
    });
    abonos.push({ apartadoId: a.apartadoId, abonoId: abono.id, monto: abono.monto, fecha: abono.fecha });
  }

  return { deposito: conSaldo(await cargarDeposito(db, depositoId)), pagos, abonos };
}

/**
 * Anula una asignación: el monto vuelve al saldo sin asignar y su `Payment` queda
 * anulado por el camino que ya existía (que reclasifica los conceptos de los
 * pagos posteriores y deja bitácora). Solo admin, igual que anular cualquier pago.
 */
export async function anularAsignacion(
  db: PrismaClient,
  depositoId: string,
  paymentId: string,
  motivo: string,
  actor: Actor,
) {
  const deposito = await cargarDeposito(db, depositoId);
  const asignacion = deposito.asignaciones.find((a) => a.id === paymentId);
  if (!asignacion) throw new QuoteError(404, 'Esa asignación no pertenece a este depósito');
  await anularPayment(db, asignacion.quoteId, paymentId, motivo, actor);
  return conSaldo(await cargarDeposito(db, depositoId));
}

/**
 * Anula el depósito completo. Exige que no tenga asignaciones vivas: si el dinero
 * ya se repartió, lo que hay que deshacer son los repartos —cada uno con su
 * motivo— y no el depósito, que sí entró al banco.
 */
export async function anularDeposito(
  db: PrismaClient,
  depositoId: string,
  rawInput: unknown,
  actor: Actor,
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede anular depósitos.');
  const { motivo } = anularDepositoSchema.parse(rawInput);
  const deposito = await cargarDeposito(db, depositoId);
  if (deposito.anuladoAt) throw new QuoteError(409, 'El depósito ya está anulado');
  const vivas = deposito.asignaciones.filter((a) => a.anuladoAt == null);
  if (vivas.length > 0) {
    throw new QuoteError(
      409,
      `Este depósito tiene ${vivas.length} asignación(es) viva(s). Anúlalas antes de anular el depósito.`,
    );
  }
  await db.pagoBanquetero.update({
    where: { id: depositoId },
    data: { anuladoAt: new Date(), anuladoById: actor.id, motivoAnulacion: motivo },
  });
  return conSaldo(await cargarDeposito(db, depositoId));
}

/** Los depósitos de un banquetero, con sus asignaciones y su saldo sin asignar. */
export async function listarDepositos(db: PrismaClient, banqueteroId: string) {
  const depositos = await db.pagoBanquetero.findMany({
    where: { banqueteroId },
    include: CON_ASIGNACIONES,
    orderBy: { fecha: 'desc' },
  });
  return depositos.map(conSaldo);
}

/** El comprobante del depósito (la ficha del banco), para la vista interna. */
export async function loadComprobanteDeposito(
  db: PrismaClient,
  storage: ComprobanteStorage,
  depositoId: string,
): Promise<{ data: Buffer; mime: string } | null> {
  const deposito = await db.pagoBanquetero.findUnique({
    where: { id: depositoId },
    select: { comprobanteKey: true, comprobanteMime: true },
  });
  if (!deposito?.comprobanteKey) return null;
  const data = await storage.load(deposito.comprobanteKey);
  if (!data) return null;
  return { data, mime: deposito.comprobanteMime ?? 'application/octet-stream' };
}
