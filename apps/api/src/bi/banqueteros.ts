import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { normalizarNombre } from '@hsa/shared';

/**
 * El BI da de alta a los banqueteros que ya trabajaban con la hacienda antes del
 * sistema, para que los eventos y apartados que manda después se liguen solos
 * por nombre (tarea C4 del encargo del BI, 5-oct-2026).
 *
 * Reglas, las mismas que la importación de eventos:
 *  - **Idempotente por nombre.** Se compara sin acentos, mayúsculas ni
 *    puntuación (`normalizarNombre`), igual que salones y tipos de evento.
 *  - **Nunca pisa.** Si ya existe, no se toca: ni nombre ni teléfono.
 *  - **Ante la duda, no crea.** Un nombre que coincide con DOS banqueteros de
 *    aquí no se adivina: se reporta `ambiguo` y no se crea un tercero.
 */

export const loteBanqueterosSchema = z.object({
  banqueteros: z
    .array(
      z.object({
        nombre: z.string().trim().min(1).max(120),
        telefono: z.string().trim().max(30).nullish(),
        correo: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1)
    .max(200),
});

export type EstadoBanquetero = 'nuevo' | 'creado' | 'existe' | 'ambiguo';

export interface ResultadoBanquetero {
  nombre: string;
  estado: EstadoBanquetero;
  /** El de aquí. `null` en `nuevo` (todavía no existe) y en `ambiguo`. */
  id: string | null;
  /** En `ambiguo`, los de aquí con los que coincide. */
  coincidencias?: { id: string; nombre: string }[];
}

async function procesar(db: PrismaClient, raw: unknown, escribir: boolean) {
  const lote = loteBanqueterosSchema.parse(raw);
  // Lo de aquí más lo que este mismo lote ya dio de alta (o daría): dos renglones
  // con el mismo nombre en un lote son UN banquetero.
  const conocidos: { id: string | null; nombre: string; clave: string }[] = (
    await db.banquetero.findMany({ select: { id: true, nombre: true } })
  ).map((b) => ({ ...b, clave: normalizarNombre(b.nombre) }));

  const resultados: ResultadoBanquetero[] = [];
  for (const b of lote.banqueteros) {
    const clave = normalizarNombre(b.nombre);
    const hits = conocidos.filter((c) => c.clave === clave);
    if (hits.length > 1) {
      resultados.push({
        nombre: b.nombre,
        estado: 'ambiguo',
        id: null,
        coincidencias: hits.filter((h) => h.id).map((h) => ({ id: h.id!, nombre: h.nombre })),
      });
      continue;
    }
    if (hits.length === 1) {
      resultados.push({ nombre: b.nombre, estado: 'existe', id: hits[0]!.id });
      continue;
    }
    if (!escribir) {
      conocidos.push({ id: null, nombre: b.nombre, clave });
      resultados.push({ nombre: b.nombre, estado: 'nuevo', id: null });
      continue;
    }
    const creado = await db.banquetero.create({
      data: { nombre: b.nombre, telefono: b.telefono || null, correo: b.correo || null },
      select: { id: true, nombre: true },
    });
    conocidos.push({ ...creado, clave });
    resultados.push({ nombre: b.nombre, estado: 'creado', id: creado.id });
  }

  const resumen: Partial<Record<EstadoBanquetero, number>> = {};
  for (const r of resultados) resumen[r.estado] = (resumen[r.estado] ?? 0) + 1;
  return { resumen, resultados };
}

/** Compara el lote con los banqueteros de aquí. No escribe NADA. */
export const conciliarBanqueteros = (db: PrismaClient, raw: unknown) => procesar(db, raw, false);

/** Crea los que no existen. Los que ya están no se tocan. */
export const importarBanqueteros = (db: PrismaClient, raw: unknown) => procesar(db, raw, true);
