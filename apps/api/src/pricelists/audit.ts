import type { Prisma } from '@hsa/database';
import type { Actor } from '../quotes/service.js';
import { impactoDeCatalogo, type Db } from './impacto.js';

/** Las cinco superficies editables de un catálogo. */
export type TipoCambioCatalogo = 'renta' | 'servicio' | 'paquete' | 'dj' | 'parametros';

export interface CambioCatalogo {
  priceListId: string;
  tipo: TipoCambioCatalogo;
  descripcion: string;
  /** Valores antes/después, ids tocados: lo que hace falta para reconstruir el cambio. */
  meta?: Prisma.InputJsonObject;
}

/**
 * Escribe un renglón en la bitácora del catálogo, con el impacto DEL MOMENTO.
 *
 * **A diferencia de `logActivity`, esta NO traga sus errores.** `logActivity`
 * hace `catch {}` a propósito —la bitácora de una cotización no debe tumbar la
 * operación— y eso ya dejó un sellado de facturas funcionando sin rastro. Aquí
 * son cambios de PRECIOS sobre un catálogo que otras cotizaciones usan: si el
 * rastro no se puede escribir, el cambio no se hace. Por eso se llama dentro de
 * la misma transacción que aplica el cambio.
 *
 * `cotizacionesEnRiesgo` se congela con el número de hoy y no se recalcula al
 * leer: la medida que importa es cuántas cotizaciones puso en riesgo quien
 * editó, entonces. Leída hoy diría otra cosa y ya no describiría el acto.
 */
export async function registrarCambioCatalogo(
  db: Db,
  cambio: CambioCatalogo,
  actor: Actor | null,
) {
  const impacto = await impactoDeCatalogo(db, cambio.priceListId);
  return db.priceListAudit.create({
    data: {
      priceListId: cambio.priceListId,
      tipo: cambio.tipo,
      descripcion: cambio.descripcion,
      // El desglose viaja DENTRO de meta: el total cabe en su columna, pero
      // "7 de 21 estaban comprometidas" es la parte que explica la decisión.
      meta: {
        ...cambio.meta,
        impacto: {
          total: impacto.total,
          comprometidas: impacto.comprometidas,
          porEstatus: impacto.porEstatus,
        },
      },
      actorId: actor?.id ?? null,
      cotizacionesEnRiesgo: impacto.total,
    },
  });
}

/** Los últimos cambios de un catálogo, del más reciente al más viejo. */
export async function listarBitacoraCatalogo(db: Db, priceListId: string, limite = 50) {
  return db.priceListAudit.findMany({
    where: { priceListId },
    orderBy: { createdAt: 'desc' },
    take: limite,
    include: { actor: { select: { id: true, nombre: true } } },
  });
}
