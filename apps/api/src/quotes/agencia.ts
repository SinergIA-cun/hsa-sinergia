import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import type { QuoteBreakdown } from '@hsa/shared';
import { QuoteError, ownershipWhere, assertNotTrashed, type Actor } from './service.js';
import { logActivity } from './activityLog.js';

/**
 * La agencia del paquete de alimentos (BI #4, 15-oct-2026): quién le paga a la
 * hacienda la comisión por el paquete. Se escoge de la lista de banqueteros,
 * nunca texto libre (el BI la cruza por su id), y NO convierte a la agencia en
 * el cliente: eso es `banqueteroId`. Sin agencia escogida, es el banquetero del
 * evento.
 */

export const agenciaSchema = z.object({ agenciaId: z.string().min(1).nullable() });

/** El paquete del evento, del catálogo o puesto desde el BI en su renglón pactado. */
export async function paqueteDelEvento(
  db: PrismaClient,
  q: { foodPackageId: string | null; breakdown: unknown; priceListId: string },
): Promise<{ clave: string; nombre: string; comisionMonto: number | null; origen: 'catalogo' | 'pactado' } | null> {
  if (q.foodPackageId) {
    const p = await db.foodPackage.findUnique({ where: { id: q.foodPackageId }, select: { clave: true, nombre: true } });
    return p ? { clave: p.clave, nombre: p.nombre, comisionMonto: null, origen: 'catalogo' } : null;
  }
  const lines = (q.breakdown as QuoteBreakdown | null)?.lines ?? [];
  const ref = lines.find((l) => l.ref?.tipo === 'pactado' && l.ref.paqueteClave)?.ref;
  if (!ref?.paqueteClave) return null;
  const candidatos = await db.foodPackage.findMany({ where: { clave: ref.paqueteClave }, select: { nombre: true, priceListId: true } });
  const p = candidatos.find((c) => c.priceListId === q.priceListId) ?? candidatos[0];
  return { clave: ref.paqueteClave, nombre: p?.nombre ?? 'Paquete', comisionMonto: ref.comisionMonto ?? null, origen: 'pactado' };
}

export async function cambiarAgencia(db: PrismaClient, quoteId: string, rawInput: unknown, actor: Actor) {
  const { agenciaId } = agenciaSchema.parse(rawInput);
  const quote = await db.quote.findFirst({
    where: { id: quoteId, ...ownershipWhere(actor) },
    include: { agencia: { select: { nombre: true } } },
  });
  if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(quote);
  if (!(await paqueteDelEvento(db, quote))) throw new QuoteError(409, 'El evento no tiene paquete de alimentos: no hay agencia que poner.');
  const nueva = agenciaId ? await db.banquetero.findUnique({ where: { id: agenciaId }, select: { id: true, nombre: true } }) : null;
  if (agenciaId && !nueva) throw new QuoteError(400, 'Esa agencia no está en la lista de banqueteros.');
  if ((quote.agenciaId ?? null) === agenciaId) return { agencia: nueva };

  await db.quote.update({ where: { id: quoteId }, data: { agenciaId } });
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Agencia del paquete: ${quote.agencia?.nombre ?? '(ninguna)'} → ${nueva?.nombre ?? '(ninguna)'}`,
    meta: { agenciaAntes: quote.agenciaId, agenciaDespues: agenciaId },
    actorId: actor.id,
  });
  return { agencia: nueva };
}
