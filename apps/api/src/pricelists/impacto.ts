import type { Prisma, PrismaClient, QuoteStatus } from '@hsa/database';
import { QuoteError } from '../quotes/service.js';

/**
 * Cliente de Prisma o cliente de transacción. Todo lo de este tramo se escribe
 * DENTRO de una transacción junto con su renglón de bitácora, así que ninguna de
 * estas funciones puede exigir el `PrismaClient` completo.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Los estatus que ya tienen dinero encima. Son los que de verdad duelen: una
 * cotización en borrador que se represia no le cuesta nada a nadie; una
 * formalizada con anticipo pagado sí.
 */
export const ESTATUS_COMPROMETIDOS = [
  'formalizada',
  'complementada',
  'liquidada',
] as const satisfies readonly QuoteStatus[];

const COMPROMETIDOS: ReadonlySet<string> = new Set(ESTATUS_COMPROMETIDOS);

export interface ImpactoCatalogo {
  priceListId: string;
  /** Nombre del catálogo, para que el aviso no muestre un cuid. */
  nombre: string;
  /** Cotizaciones VIVAS casadas a este catálogo. La papelera no cuenta. */
  total: number;
  /** Cuántas de esas son `formalizada`, `complementada` o `liquidada`. */
  comprometidas: number;
  porEstatus: Record<string, number>;
}

/**
 * Cuántas cotizaciones puede represiar editar este catálogo, desglosadas por
 * estatus.
 *
 * La papelera se excluye: una cotización borrada no se va a reeditar, y contarla
 * infla el aviso hasta que nadie lo lee.
 *
 * Editar un catálogo NO reescribe ninguna de estas cotizaciones — sus `total` y
 * `breakdown` guardados quedan congelados. El número mide el riesgo de que
 * alguien REEDITE una de ellas después, que es cuando se recalcula.
 */
export async function impactoDeCatalogo(db: Db, priceListId: string): Promise<ImpactoCatalogo> {
  const catalogo = await db.priceList.findUnique({
    where: { id: priceListId },
    select: { id: true, nombre: true },
  });
  if (!catalogo) throw new QuoteError(404, `El catálogo ${priceListId} no existe`);

  const grupos = await db.quote.groupBy({
    by: ['status'],
    where: { priceListId, deletedAt: null },
    _count: { _all: true },
  });

  const porEstatus: Record<string, number> = {};
  let total = 0;
  let comprometidas = 0;
  for (const g of grupos) {
    const n = g._count._all;
    if (n === 0) continue; // un grupo vacío rompería la igualdad "suma del desglose = total"
    porEstatus[g.status] = n;
    total += n;
    if (COMPROMETIDOS.has(g.status)) comprometidas += n;
  }

  return { priceListId: catalogo.id, nombre: catalogo.nombre, total, comprometidas, porEstatus };
}
