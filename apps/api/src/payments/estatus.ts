import type { PrismaClient } from '@hsa/database';
import { loadEstadoCuenta } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import { esUpgrade } from '../quotes/estadoCuenta.js';
import { archivarEvento } from '../historico/archivar.js';
import { reclasificarConceptos } from './conceptos.js';

/**
 * Pone al día un evento después de que su dinero cambió por fuera del flujo de
 * registrar un pago (un pago corregido, uno que llegó o se fue a otro evento):
 * reetiqueta los conceptos, ajusta el estatus y actualiza la foto del histórico.
 *
 * El estatus sube solo si el dinero cruza un hito, y un evento `liquidada` que
 * ya no cubre su total baja al que digan sus pagos. Nunca baja de formalizada:
 * eso es una decisión, no una cuenta (igual que al anular).
 */
export async function ponerAlDia(db: PrismaClient, quoteId: string, actorId: string, por: string) {
  const quote = await db.quote.findUniqueOrThrow({ where: { id: quoteId } });
  await reclasificarConceptos(db, quote, { actorId });
  const { estadoCuenta } = await loadEstadoCuenta(db, quote);
  const sugerido = estadoCuenta.sugerido;
  let nuevo: string | null = null;
  // Sin ningún hito cubierto, un evento liquidado regresa a formalizada. Sin plan
  // de pagos (`planPendiente`) no hay hitos que leer: no se toca.
  if (quote.status === 'liquidada' && !estadoCuenta.planPendiente && sugerido !== 'liquidada') nuevo = sugerido ?? 'formalizada';
  else if (esUpgrade(quote.status, sugerido)) nuevo = sugerido;
  if (nuevo && nuevo !== quote.status) {
    await db.quote.update({ where: { id: quoteId }, data: { status: nuevo as typeof quote.status } });
    await logActivity(db, {
      quoteId,
      tipo: 'estatus',
      descripcion: `Estatus: ${quote.status} → ${nuevo} (automático: ${por})`,
      meta: { de: quote.status, a: nuevo, auto: true },
      actorId,
    });
  }
  await archivarEvento(db, quoteId);
}
