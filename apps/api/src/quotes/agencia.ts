import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import { COMISION_HSA_POR_OMISION, montoNoNegativoSchema, pesosTexto, type QuoteBreakdown } from '@hsa/shared';
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

export const comisionSchema = z.object({ comisionPct: z.number().min(0).max(100) });

/**
 * La comisión de HSA de un evento SIN agencia ni cliente profesional (21-oct-2026):
 * el proveedor de alimentos no siempre se da de alta, así que vive en el evento.
 * Con agencia o cliente, manda la de su ficha y aquí no se cambia.
 */
export async function cambiarComision(db: PrismaClient, quoteId: string, rawInput: unknown, actor: Actor) {
  const { comisionPct } = comisionSchema.parse(rawInput);
  const quote = await db.quote.findFirst({ where: { id: quoteId, ...ownershipWhere(actor) } });
  if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(quote);
  if (quote.agenciaId || quote.banqueteroId) {
    throw new QuoteError(409, 'La comisión de este evento es la de su cliente o agencia: cámbiala en su ficha de Prof. Evento.');
  }
  const antes = quote.comisionPct ?? COMISION_HSA_POR_OMISION;
  if (antes === comisionPct) return { comisionPct };
  await db.quote.update({ where: { id: quoteId }, data: { comisionPct } });
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Comisión de HSA del evento: ${antes}% → ${comisionPct}%`,
    meta: { comisionAntes: antes, comisionDespues: comisionPct },
    actorId: actor.id,
  });
  return { comisionPct };
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
  if (agenciaId && !nueva) throw new QuoteError(400, 'Esa agencia no está en Prof. Evento.');
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

export const comisionPaqueteSchema = z.object({ comisionMonto: montoNoNegativoSchema.nullable() });

/**
 * La comisión de la agencia por un paquete que vino del BI (11-nov-2026: hay
 * paquetes importados sin comisión y no había dónde ponerla). Es un monto fijo, igual que la que
 * manda el BI en `/importar/paquetes`, y vive en el renglón pactado. `null` la quita.
 */
export async function cambiarComisionPaquete(db: PrismaClient, quoteId: string, rawInput: unknown, actor: Actor) {
  const { comisionMonto } = comisionPaqueteSchema.parse(rawInput);
  const quote = await db.quote.findFirst({ where: { id: quoteId, ...ownershipWhere(actor) } });
  if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(quote);
  const paquete = await paqueteDelEvento(db, quote);
  if (paquete?.origen !== 'pactado') {
    throw new QuoteError(409, 'Solo un paquete que vino del BI lleva comisión en monto; la de un paquete del catálogo es en %.');
  }
  const desglose = quote.breakdown as unknown as QuoteBreakdown;
  const i = desglose.lines.findIndex((l) => l.ref?.tipo === 'pactado' && l.ref.paqueteClave);
  const linea = desglose.lines[i]!;
  if (comisionMonto != null && comisionMonto > linea.monto) {
    throw new QuoteError(400, `La comisión no puede ser mayor que los alimentos y servicios pactados (${pesosTexto(linea.monto)}).`);
  }
  const antes = linea.ref?.comisionMonto ?? null;
  if (antes === comisionMonto) return { comisionMonto };
  const lines = desglose.lines.map((l, j) => (j === i ? { ...l, ref: { ...l.ref!, comisionMonto } } : l));
  await db.quote.update({ where: { id: quoteId }, data: { breakdown: { ...desglose, lines } as unknown as Prisma.InputJsonValue } });
  const texto = (n: number | null) => (n == null ? '(sin comisión)' : pesosTexto(n));
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Comisión de la agencia por el paquete: ${texto(antes)} → ${texto(comisionMonto)}`,
    meta: { comisionMontoAntes: antes, comisionMontoDespues: comisionMonto },
    actorId: actor.id,
  });
  return { comisionMonto };
}
