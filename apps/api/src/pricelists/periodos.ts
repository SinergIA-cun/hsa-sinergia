import type { PrismaClient } from '@hsa/database';
import { diasDePeriodo, type PeriodoLista } from '@hsa/shared';
import { z } from 'zod';
import { QuoteError, type Actor } from '../quotes/service.js';
import { registrarCambioCatalogo } from './audit.js';

/**
 * Periodos de fechas ↔ lista de precios (24-nov-2026). La regla de cuál gana
 * vive en `@hsa/shared` → `listaParaFecha`; aquí solo se guardan y se cuida
 * que nunca quede un empate sin resolver.
 */

const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Fecha inválida');

export const periodoSchema = z
  .object({
    priceListId: z.string().min(1),
    desde: fechaIso,
    hasta: fechaIso,
    nota: z.string().trim().max(120).optional().nullable(),
  })
  .refine((p) => p.desde <= p.hasta, { message: 'La fecha de inicio no puede ser después de la final', path: ['hasta'] });

const aIso = (d: Date) => d.toISOString().slice(0, 10);
const aFecha = (s: string) => new Date(`${s}T00:00:00.000Z`);

type FilaPeriodo = { id: string; priceListId: string; desde: Date; hasta: Date; nota: string | null };

function aPeriodo(f: FilaPeriodo): PeriodoLista {
  return { id: f.id, priceListId: f.priceListId, desde: aIso(f.desde), hasta: aIso(f.hasta), nota: f.nota };
}

export async function listarPeriodos(db: PrismaClient): Promise<PeriodoLista[]> {
  const filas = await db.periodoLista.findMany({ orderBy: [{ desde: 'asc' }, { hasta: 'asc' }] });
  return filas.map(aPeriodo);
}

/**
 * Un periodo que se empalma con otro DEL MISMO LARGO y otra lista dejaría
 * fechas sin dueño claro (ninguno es más específico). Se rechaza al guardar
 * para que la pantalla de cotizar nunca tenga que adivinar.
 */
function empateCon(nuevo: Omit<PeriodoLista, 'id'>, existentes: PeriodoLista[]): PeriodoLista | undefined {
  const largo = diasDePeriodo(nuevo);
  return existentes.find(
    (p) =>
      p.priceListId !== nuevo.priceListId &&
      p.desde <= nuevo.hasta &&
      nuevo.desde <= p.hasta &&
      diasDePeriodo(p) === largo,
  );
}

export async function crearPeriodo(db: PrismaClient, body: unknown, actor: Actor | null): Promise<PeriodoLista> {
  const datos = periodoSchema.parse(body);
  return db.$transaction(async (tx) => {
    const lista = await tx.priceList.findUnique({ where: { id: datos.priceListId }, select: { nombre: true } });
    if (!lista) throw new QuoteError(404, 'Esa lista de precios no existe');

    const existentes = (await tx.periodoLista.findMany()).map(aPeriodo);
    const choque = empateCon(datos, existentes);
    if (choque) {
      const otra = await tx.priceList.findUnique({ where: { id: choque.priceListId }, select: { nombre: true } });
      throw new QuoteError(
        409,
        `Se empalma con el periodo ${choque.desde} → ${choque.hasta} de "${otra?.nombre ?? 'otra lista'}", que dura lo mismo: no habría forma de saber cuál aplica. Ajusta las fechas o borra el otro.`,
        { periodoId: choque.id },
      );
    }

    const fila = await tx.periodoLista.create({
      data: { priceListId: datos.priceListId, desde: aFecha(datos.desde), hasta: aFecha(datos.hasta), nota: datos.nota || null },
    });
    await registrarCambioCatalogo(
      tx,
      {
        priceListId: datos.priceListId,
        tipo: 'periodo',
        descripcion: `Agregó el periodo ${datos.desde} → ${datos.hasta}${datos.nota ? ` (${datos.nota})` : ''}`,
        meta: { periodoId: fila.id, desde: datos.desde, hasta: datos.hasta },
      },
      actor,
    );
    return aPeriodo(fila);
  });
}

export async function borrarPeriodo(db: PrismaClient, id: string, actor: Actor | null): Promise<{ ok: true }> {
  return db.$transaction(async (tx) => {
    const fila = await tx.periodoLista.findUnique({ where: { id } });
    if (!fila) throw new QuoteError(404, 'Ese periodo no existe');
    await tx.periodoLista.delete({ where: { id } });
    const p = aPeriodo(fila);
    await registrarCambioCatalogo(
      tx,
      {
        priceListId: p.priceListId,
        tipo: 'periodo',
        descripcion: `Quitó el periodo ${p.desde} → ${p.hasta}${p.nota ? ` (${p.nota})` : ''}`,
        meta: { periodoId: p.id, desde: p.desde, hasta: p.hasta },
      },
      actor,
    );
    return { ok: true as const };
  });
}
