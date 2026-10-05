import type { PrismaClient, Prisma } from '@hsa/database';
import {
  PRODUCTOS_CARGO,
  afectaContrato,
  conCargosDelContrato,
  lineaDeCargo,
  type QuoteBreakdown,
} from '@hsa/shared';

/** Los productos que suben el valor del contrato (horas extra de salón, PAX extra). */
export const PRODUCTOS_DEL_CONTRATO = PRODUCTOS_CARGO.filter(afectaContrato);

/**
 * Pone en el desglose del evento los cargos VIGENTES que suben el contrato, y
 * deja `total` y `rentaTotal` de acuerdo.
 *
 * Idempotente y central a propósito: lo llaman registrar y anular un cargo, y
 * también todo lo que recalcula el desglose desde el catálogo (editar el evento,
 * moverlo de catálogo). Sin esto, el siguiente recálculo borraría las horas extra
 * del contrato en silencio.
 *
 * Módulo hoja (solo Prisma y shared): lo importa `quotes/service.ts` sin ciclos.
 */
export async function sincronizarContrato(db: PrismaClient, quoteId: string): Promise<{ antes: number; despues: number }> {
  const q = await db.quote.findUniqueOrThrow({
    where: { id: quoteId },
    select: { breakdown: true, total: true, priceListId: true },
  });
  const b = q.breakdown as unknown as QuoteBreakdown | null;
  if (!b?.lines) return { antes: q.total, despues: q.total };
  const [cargos, lista] = await Promise.all([
    db.cargoEvento.findMany({
      where: { quoteId, anuladoAt: null, producto: { in: PRODUCTOS_DEL_CONTRATO } },
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
    }),
    db.priceList.findUnique({ where: { id: q.priceListId }, select: { ivaRate: true } }),
  ]);
  const nuevo = conCargosDelContrato(b, cargos.map(lineaDeCargo), lista?.ivaRate ?? 0.16);
  const yaEstaba =
    JSON.stringify(b.lines.filter((l) => l.cargoId)) === JSON.stringify(nuevo.lines.filter((l) => l.cargoId));
  if (yaEstaba) return { antes: q.total, despues: q.total };
  const total = Math.round(nuevo.total);
  await db.quote.update({
    where: { id: quoteId },
    data: {
      breakdown: nuevo as unknown as Prisma.InputJsonValue,
      total,
      rentaTotal: Math.round(nuevo.rentaTotal),
    },
  });
  return { antes: q.total, despues: total };
}
