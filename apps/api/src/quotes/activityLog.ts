import type { PrismaClient, Prisma } from '@hsa/database';

export type LogTipo =
  | 'creada'
  | 'estatus'
  | 'pago'
  | 'pagoAnulado'
  | 'edicion'
  | 'eliminada'
  | 'restaurada'
  /** Se emitió (o se selló a mano) un CFDI por un pago. */
  | 'factura'
  /** Cambiaron los datos fiscales del cliente (incluido el desbloqueo de admin). */
  | 'fiscal'
  /**
   * Un admin movió la cotización a otro catálogo (se represió a propósito).
   *
   * Todo valor de esta unión necesita ADEMÁS su `ALTER TYPE "ActivityType"
   * ADD VALUE`: sin él este `create` falla y el `catch {}` de abajo se lo traga,
   * dejando la operación sin rastro. El typecheck no ve ese hueco; solo lo caza
   * un test que cuente los registros escritos.
   */
  | 'catalogo';

/** Escribe una entrada de bitácora. Nunca lanza: la bitácora no debe tumbar la operación. */
export async function logActivity(
  db: PrismaClient,
  input: { quoteId: string; tipo: LogTipo; descripcion: string; meta?: Prisma.InputJsonValue; actorId?: string | null },
): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        quoteId: input.quoteId,
        tipo: input.tipo,
        descripcion: input.descripcion,
        meta: input.meta,
        actorId: input.actorId ?? null,
      },
    });
  } catch {
    // no-op: la bitácora es best-effort
  }
}
