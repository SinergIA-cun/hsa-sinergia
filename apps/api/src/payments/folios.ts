import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { formatFolio } from '@hsa/shared';
import { QuoteError, type Actor } from '../quotes/service.js';

/**
 * El folio de la serie `I`: el número de la hoja foliada de la hacienda.
 *
 * Llevan años numerando a mano cada dinero que entra, y la numeración del
 * sistema tiene que seguir donde se quedó la de papel. Por eso el número con el
 * que arranca lo captura un admin, sin renumerar nada de lo ya registrado
 * (decisión del dueño).
 *
 * Una entrada de dinero gasta un folio: un pago directo, un depósito de
 * banquetero o un abono directo a una fecha apartada. Repartir un depósito o
 * convertir un abono NO es dinero nuevo y hereda el folio de su entrada.
 *
 * El contador es la secuencia `recibo_folio_seq` de Postgres —la misma para las
 * tres tablas—, porque `nextval` es atómico: dos cobros simultáneos en dos
 * tabletas no pueden sacar el mismo número.
 */

export const fijarFolioSchema = z.object({
  /** El número que llevará el SIGUIENTE dinero que entre. */
  siguiente: z.number().int().positive().max(2_000_000_000),
});

/** El folio más alto que ya se usó en cualquiera de las tres tablas. */
async function ultimoFolioUsado(db: PrismaClient): Promise<number | null> {
  const [fila] = await db.$queryRaw<{ max: number | null }[]>`
    SELECT GREATEST(
      (SELECT max("folio") FROM "Payment"),
      (SELECT max("folio") FROM "PagoBanquetero"),
      (SELECT max("folio") FROM "AbonoApartado")
    )::int AS max`;
  return fila?.max ?? null;
}

/**
 * El número que va a llevar el siguiente dinero, leído de la secuencia SIN
 * gastarlo. `is_called = false` es el estado justo después de un
 * `setval(n, false)`: el siguiente `nextval` devuelve `n` y no `n + 1`.
 */
async function siguienteDeLaSecuencia(db: PrismaClient): Promise<number> {
  const [fila] = await db.$queryRaw<{ last_value: bigint; is_called: boolean }[]>`
    SELECT last_value, is_called FROM recibo_folio_seq`;
  if (!fila) throw new Error('No existe la secuencia recibo_folio_seq');
  const ultimo = Number(fila.last_value);
  return fila.is_called ? ultimo + 1 : ultimo;
}

export async function estadoFolios(db: PrismaClient) {
  const [siguiente, ultimoUsado, cambios] = await Promise.all([
    siguienteDeLaSecuencia(db),
    ultimoFolioUsado(db),
    db.cambioFolio.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { actor: { select: { nombre: true } } },
    }),
  ]);
  return {
    serie: 'I',
    siguiente,
    siguienteTexto: formatFolio(siguiente),
    ultimoUsado,
    cambios: cambios.map((c) => ({
      id: c.id,
      siguiente: c.siguiente,
      anterior: c.anterior,
      actor: c.actor?.nombre ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

/**
 * Fija el número con el que sigue la serie. Solo admin, y con rastro.
 *
 * No puede ir hacia atrás de un folio ya usado: dos recibos con el mismo número
 * son justo lo que una hoja foliada existe para impedir. Sí puede saltar hacia
 * adelante (es lo normal la primera vez: de los pocos pagos de prueba al 5332
 * que sigue en papel).
 */
export async function fijarSiguienteFolio(db: PrismaClient, rawInput: unknown, actor: Actor) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede cambiar el folio.');
  const { siguiente } = fijarFolioSchema.parse(rawInput);
  const [anterior, ultimoUsado] = await Promise.all([siguienteDeLaSecuencia(db), ultimoFolioUsado(db)]);
  if (ultimoUsado != null && siguiente <= ultimoUsado) {
    throw new QuoteError(
      409,
      `El folio ${formatFolio(ultimoUsado)} ya se usó. El siguiente tiene que ser mayor, o habría dos recibos con el mismo número.`,
    );
  }
  // `false`: el siguiente `nextval` devuelve exactamente `siguiente`.
  await db.$executeRaw`SELECT setval('recibo_folio_seq', ${siguiente}::bigint, false)`;
  await db.cambioFolio.create({ data: { siguiente, anterior, actorId: actor.id } });
  return estadoFolios(db);
}
