import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { QuoteError, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import { yaPaso } from './archivar.js';

export const eliminarDelHistoricoSchema = z.object({
  motivo: z.string().trim().min(3, 'Escribe por qué se elimina').max(300),
});

/**
 * Quita del Histórico un evento que nunca existió de verdad (una prueba).
 *
 * "Quiero un botón para borrar, solo para el admin. De eventos históricos" (el
 * dueño, 5-oct-2026). Es la ÚNICA puerta para que un evento con pagos o ya
 * formalizado llegue a la papelera; `softDeleteQuote` lo sigue prohibiendo para
 * todo lo demás. Por eso tiene tres candados:
 *
 *  - **Solo admin**, con motivo obligatorio que queda en la bitácora.
 *  - **Solo eventos que ya pasaron.** Un evento por venir con pagos es dinero
 *    vivo de un cliente: se cancela (con su devolución), no se borra.
 *  - **No borra nada todavía.** Va a la papelera: deja de verse en Eventos,
 *    Agenda, Histórico, tablero y BI, se puede restaurar 30 días, y después la
 *    purga lo borra con sus pagos, cargos y fotos.
 */
export async function eliminarDelHistorico(db: PrismaClient, quoteId: string, rawInput: unknown, actor: Actor) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede eliminar un evento del Histórico.');
  const { motivo } = eliminarDelHistoricoSchema.parse(rawInput);
  const quote = await db.quote.findUnique({ where: { id: quoteId }, select: { id: true, fechaEvento: true, deletedAt: true, status: true } });
  if (!quote) throw new QuoteError(404, 'Evento no encontrado');
  if (quote.deletedAt) throw new QuoteError(409, 'Ese evento ya está en la papelera.');
  if (!yaPaso(quote.fechaEvento)) {
    throw new QuoteError(409, 'Solo se eliminan eventos que ya pasaron. Uno por venir se cancela desde el evento.');
  }
  await db.quote.update({ where: { id: quoteId }, data: { deletedAt: new Date() } });
  await logActivity(db, {
    quoteId,
    tipo: 'eliminada',
    descripcion: `Eliminado del Histórico (estaba ${quote.status}): ${motivo}`,
    meta: { desde: 'historico', statusPrevio: quote.status, motivo },
    actorId: actor.id,
  });
}
