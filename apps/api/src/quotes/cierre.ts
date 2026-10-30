import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@hsa/database';
import { QuoteError, assertNotTrashed, type Actor } from './service.js';
import { logActivity } from './activityLog.js';

/**
 * "Cerrar evento" (reunión del 15-oct-2026): ya conciliado, el evento queda
 * congelado —datos, pagos, cargos, devoluciones, fecha, estatus— para todos,
 * admin incluido, hasta que un admin lo reabra con motivo. Cerrar y reabrir
 * quedan en la bitácora.
 *
 * El candado vive en un solo lugar (`candadoDeEventoCerrado`): toda escritura
 * bajo `/api/quotes/:id/…` pasa por él. Lo que se permite con el evento cerrado
 * es lo que no cambia el evento: facturar un pago (eso pasa después del cierre
 * de mes), reenviar un correo, duplicarlo y las vistas previas.
 */

const PERMITIDO_CERRADO = [
  /\/(cerrar|reabrir)$/,
  /\/simular$/,
  /\/duplicate$/,
  /\/correos\/:correoId\/reenviar$/,
  /\/payments\/:paymentId\/(facturado|facturar|desbloquear-factura)$/,
];

export const MENSAJE_CERRADO = 'El evento está cerrado: un admin tiene que reabrirlo (con motivo) para cambiar algo.';

const ESTATUS_CERRABLES = new Set(['formalizada', 'complementada', 'liquidada', 'cancelada']);
const reabrirSchema = z.object({ motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 letras).').max(300) });
const cerrarSchema = z.object({ nota: z.string().trim().max(300).optional() });

export async function assertAbierto(db: PrismaClient, quoteId: string): Promise<void> {
  const q = await db.quote.findUnique({ where: { id: quoteId }, select: { cerradoAt: true } });
  if (q?.cerradoAt) throw new QuoteError(409, MENSAJE_CERRADO);
}

export function candadoDeEventoCerrado(app: FastifyInstance): void {
  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const ruta = req.routeOptions.url ?? '';
    if (!ruta.startsWith('/api/quotes/:id')) return;
    if (PERMITIDO_CERRADO.some((r) => r.test(ruta))) return;
    // Sin sesión, la ruta responde su 401: el candado no anuncia nada.
    if (!(req as { user?: unknown }).user) return;
    const id = (req.params as { id?: string }).id;
    if (!id) return;
    const q = await app.prisma.quote.findUnique({ where: { id }, select: { cerradoAt: true } });
    if (q?.cerradoAt) return reply.code(409).send({ error: MENSAJE_CERRADO });
  });
}

export async function cerrarEvento(db: PrismaClient, id: string, raw: unknown, actor: Actor) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin cierra un evento.');
  const { nota } = cerrarSchema.parse(raw ?? {});
  const q = await db.quote.findUnique({ where: { id } });
  if (!q) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(q);
  if (q.cerradoAt) throw new QuoteError(409, 'El evento ya está cerrado.');
  if (!ESTATUS_CERRABLES.has(q.status)) throw new QuoteError(409, 'Solo se cierra un evento formalizado, liquidado o cancelado.');
  const ahora = new Date();
  await db.quote.update({ where: { id }, data: { cerradoAt: ahora, cerradoById: actor.id } });
  await logActivity(db, {
    quoteId: id,
    tipo: 'estatus',
    descripcion: `Evento cerrado: ya no se puede cambiar${nota ? `. Nota: ${nota}` : ''}`,
    meta: { cerrado: true, ...(nota ? { nota } : {}) },
    actorId: actor.id,
  });
  return { cerradoAt: ahora.toISOString() };
}

export async function reabrirEvento(db: PrismaClient, id: string, raw: unknown, actor: Actor) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin reabre un evento cerrado.');
  const { motivo } = reabrirSchema.parse(raw);
  const q = await db.quote.findUnique({ where: { id }, select: { cerradoAt: true } });
  if (!q) throw new QuoteError(404, 'Cotización no encontrada');
  if (!q.cerradoAt) throw new QuoteError(409, 'El evento no está cerrado.');
  await db.quote.update({ where: { id }, data: { cerradoAt: null, cerradoById: null } });
  await logActivity(db, {
    quoteId: id,
    tipo: 'estatus',
    descripcion: `Evento reabierto. Motivo: ${motivo}`,
    meta: { reabierto: true, cerradoAt: q.cerradoAt.toISOString(), motivo },
    actorId: actor.id,
  });
  return { ok: true };
}
