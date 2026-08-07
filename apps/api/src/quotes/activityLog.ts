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
  | 'fiscal';

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
