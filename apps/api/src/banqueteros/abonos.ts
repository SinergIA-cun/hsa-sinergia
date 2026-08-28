import { z } from 'zod';
import type { PrismaClient, Prisma, PaymentMethod } from '@hsa/database';
import { QuoteError, type Actor } from '../quotes/service.js';
import type { ComprobanteStorage } from '../payments/storage.js';

/**
 * Los abonos sobre una fecha apartada.
 *
 * Un apartado **no tiene precio**: 2029 no tiene catálogo, ni PAX, ni tipo de
 * evento. Así que esto no es "abonar a una deuda" —no hay deuda que abonar— sino
 * juntar dinero a favor de esa fecha, que es literalmente lo que hace un
 * banquetero: pide 2029, abona durante 2027 y para 2028 puede tenerla pagada sin
 * saber todavía si será una boda o una graduación.
 *
 * Por eso aquí no hay saldo pendiente ni plan de pagos. Eso empieza cuando el
 * apartado se convierte en cotización: ahí aparece el precio y cada abono se
 * vuelve un `Payment` **con la fecha en que entró**.
 */

/**
 * Los montos se capturan, no se calculan: `int` rechaza los decimales en vez de
 * redondearlos. Prisma TRUNCA los flotantes al escribir en una columna `Int`.
 */
const montoCapturado = z.number().int().positive();

export const abonoSchema = z.object({
  monto: montoCapturado,
  metodo: z.enum(['efectivo', 'transferencia', 'tarjeta']),
  /** Cuándo se RECIBIÓ el dinero, no cuándo se captura. */
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referencia: z.string().max(120).optional(),
});

export const anularAbonoSchema = z.object({ motivo: z.string().min(3) });

/** Un abono visto por el cálculo del acumulado. */
export interface AbonoLite {
  monto: number;
  anuladoAt: Date | null;
}

/** Lo que lleva juntado esta fecha. Los anulados no cuentan. */
export function totalAbonado(abonos: readonly AbonoLite[]): number {
  return abonos.filter((a) => a.anuladoAt == null).reduce((s, a) => s + a.monto, 0);
}

export const INCLUDE_ABONOS = {
  abonos: {
    orderBy: { fecha: 'asc' },
    include: {
      registradoBy: { select: { nombre: true } },
      pagoBanquetero: { select: { id: true, fecha: true, referencia: true } },
    },
  },
} as const;

/**
 * Un apartado solo recibe dinero mientras está VIVO.
 *
 * Convertido, el dinero va a la cotización por la vía normal; cancelado, la fecha
 * se liberó y meterle dinero sería registrar un cobro sobre algo que ya no
 * existe. Las dos serían formas de perder el rastro de un pago.
 */
async function apartadoQuePuedeRecibir(db: PrismaClient, apartadoId: string) {
  const apartado = await db.apartadoFecha.findUnique({
    where: { id: apartadoId },
    select: { id: true, banqueteroId: true, quoteId: true, canceladoAt: true },
  });
  if (!apartado) throw new QuoteError(404, 'Apartado no encontrado');
  if (apartado.canceladoAt) {
    throw new QuoteError(409, 'El apartado está cancelado: la fecha ya se liberó.');
  }
  if (apartado.quoteId) {
    throw new QuoteError(
      409,
      'Este apartado ya es una cotización: los pagos se registran ahí, no aquí.',
    );
  }
  return apartado;
}

/**
 * Un abono directo a la fecha: alguien pagó ESTA fecha, no la cuenta del
 * banquetero. Solo admin, igual que los depósitos: es dinero que entra.
 */
export async function registrarAbono(
  db: PrismaClient,
  storage: ComprobanteStorage,
  apartadoId: string,
  rawInput: unknown,
  actor: Actor,
  file?: { data: Buffer; mime: string },
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede registrar abonos.');
  const input = abonoSchema.parse(rawInput);
  await apartadoQuePuedeRecibir(db, apartadoId);

  let comprobanteKey: string | null = null;
  let comprobanteMime: string | null = null;
  if (file) {
    const stored = await storage.save(file.data, file.mime);
    comprobanteKey = stored.key;
    comprobanteMime = stored.mime;
  }

  return db.abonoApartado.create({
    data: {
      apartadoId,
      monto: input.monto,
      metodo: input.metodo,
      // Día calendario a medianoche UTC, como `Payment.fecha`: es la que hereda
      // el pago al convertir, y el candado fiscal la compara contra el día civil
      // de México, que vive en ese mismo espacio.
      fecha: new Date(`${input.fecha}T00:00:00.000Z`),
      referencia: input.referencia ?? null,
      comprobanteKey,
      comprobanteMime,
      registradoById: actor.id,
    },
  });
}

/**
 * Un abono que sale del saldo a favor del banquetero.
 *
 * Lo llama el reparto de un depósito, no una ruta propia: repartir dinero ya
 * recibido es una sola operación con dos clases de destino —sus eventos y sus
 * fechas apartadas— y separarlas en dos pantallas sería el mismo dinero repartido
 * desde dos lugares.
 *
 * Hereda la fecha del DEPÓSITO, no la de hoy, por la misma razón que las
 * asignaciones a eventos: el ingreso se factura en el mes en que se recibió.
 */
export async function abonarDesdeDeposito(
  db: PrismaClient | Prisma.TransactionClient,
  args: {
    apartadoId: string;
    depositoId: string;
    monto: number;
    metodo: PaymentMethod;
    fechaDeposito: Date;
    actorId: string;
  },
) {
  return db.abonoApartado.create({
    data: {
      apartadoId: args.apartadoId,
      monto: args.monto,
      metodo: args.metodo,
      fecha: args.fechaDeposito,
      referencia: 'Del saldo del banquetero',
      pagoBanqueteroId: args.depositoId,
      registradoById: args.actorId,
    },
  });
}

/**
 * Anula un abono. Solo admin: mover dinero hacia atrás es de admin, igual que
 * anular un pago o un depósito.
 *
 * Si venía de un depósito, su monto **vuelve solo** al saldo sin asignar: el
 * cálculo mira los abonos vivos, así que anularlo lo devuelve sin necesidad de
 * tocar el depósito.
 */
export async function anularAbono(
  db: PrismaClient,
  abonoId: string,
  rawInput: unknown,
  actor: Actor,
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede anular un abono.');
  const { motivo } = anularAbonoSchema.parse(rawInput);
  const abono = await db.abonoApartado.findUnique({ where: { id: abonoId } });
  if (!abono) throw new QuoteError(404, 'Abono no encontrado');
  if (abono.anuladoAt) throw new QuoteError(409, 'Ese abono ya está anulado.');
  if (abono.paymentId) {
    throw new QuoteError(
      409,
      'Ese abono ya se convirtió en un pago de la cotización: anúlalo desde ahí.',
    );
  }

  return db.abonoApartado.update({
    where: { id: abonoId },
    data: { anuladoAt: new Date(), anuladoById: actor.id, motivoAnulacion: motivo },
  });
}

/** El comprobante de un abono, para la vista interna. */
export async function loadComprobanteAbono(
  db: PrismaClient,
  storage: ComprobanteStorage,
  abonoId: string,
): Promise<{ data: Buffer; mime: string } | null> {
  const abono = await db.abonoApartado.findUnique({
    where: { id: abonoId },
    select: { comprobanteKey: true, comprobanteMime: true },
  });
  if (!abono?.comprobanteKey) return null;
  const data = await storage.load(abono.comprobanteKey);
  return data ? { data, mime: abono.comprobanteMime ?? 'image/jpeg' } : null;
}
