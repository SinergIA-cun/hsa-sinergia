import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { COLUMNAS_BASE, validarBrackets, validarColumnas, type ColumnaRenta } from '@hsa/shared';
import { QuoteError, type Actor } from '../quotes/service.js';
import { contratosQueUsan } from '../quotes/usos.js';
import { columnasDe, preciosDe, tablasDe, type TablaRentaDef } from '../catalog/loader.js';
import { assertCatalogo } from './editar.js';
import { registrarCambioCatalogo } from './audit.js';

/**
 * La tabla de renta completa de un catálogo, como una hoja de cálculo
 * (16-oct-2026): columnas con su regla (días y meses), renglones por salón y
 * rango de invitados, y los precios de cada celda. Se guarda TODA de una vez.
 *
 * Antes solo se editaban precios: las cuatro columnas eran fijas y los rangos no
 * se tocaban "porque un hueco rompe el cotizador". La puerta se abre con la
 * misma red, ahora al guardar: los rangos de cada salón se validan (sin huecos
 * ni traslapes) y las reglas de las columnas también (sin empates).
 *
 * **La estructura de un catálogo en uso no se cambia.** Si algún evento ya está
 * casado con él, quitar un rango o cambiar la regla de una columna haría que ese
 * evento ya no se pudiera recalcular. Ahí solo se cambian precios y nombres de
 * columna; para lo demás, se crea un catálogo nuevo copiándolo.
 *
 * **Tablas** (21-oct-2026): la renta se reparte en hojas con nombre —"Renta",
 * "Renta plana (Team Building)", las que se creen— y cada una dice a qué tipos
 * de evento se le cobra con ella. Un tipo va en UNA tabla; uno que no quede en
 * ninguna no se puede cotizar, y se avisa. Renombrar una tabla siempre se
 * puede; crear, borrar o cambiarle tipos de evento es estructura.
 */

const CLAVE = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Clave de columna inválida');

const columnaSchema = z.object({
  clave: CLAVE,
  nombre: z.string().trim().min(1).max(40),
  dias: z.array(z.number().int().min(0).max(6)).max(7),
  meses: z.array(z.number().int().min(1).max(12)).max(12),
  respaldo: CLAVE.nullable(),
});

const renglonSchema = z.object({
  /** Sin id = renglón nuevo. */
  id: z.string().min(1).optional(),
  spaceId: z.string().min(1),
  /** La clave de su tabla. */
  tipo: CLAVE,
  min: z.number().int().min(1),
  max: z.number().int().min(1).nullable(),
  /** Pesos enteros por clave de columna; `null` = sin precio. Prisma trunca flotantes: se exige `int()`. */
  precios: z.record(CLAVE, z.number().int().nonnegative().nullable()),
});

const tablaSchema = z.object({
  clave: CLAVE,
  nombre: z.string().trim().min(1, 'Ponle nombre a la tabla.').max(60),
  eventTypeIds: z.array(z.string().min(1)).max(100),
});

export const tablaRentaSchema = z.object({
  columnas: z.array(columnaSchema).min(1).max(20),
  /** Omitidas = se quedan las que hay. */
  tablas: z.array(tablaSchema).min(1, 'Tiene que quedar al menos una tabla de renta.').max(20).optional(),
  renglones: z.array(renglonSchema).max(500),
});

const unico = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
const distintos = (xs: string[]) => [...new Set(xs)];
const reglaDe = (c: ColumnaRenta) => JSON.stringify([unico(c.dias), unico(c.meses), c.respaldo]);

export async function guardarTablaRenta(db: PrismaClient, priceListId: string, rawInput: unknown, actor: Actor | null) {
  const input = tablaRentaSchema.parse(rawInput);
  const columnas: ColumnaRenta[] = input.columnas.map((c) => ({ ...c, dias: unico(c.dias), meses: unico(c.meses) }));

  const claves = columnas.map((c) => c.clave);
  if (new Set(claves).size !== claves.length) throw new QuoteError(400, 'Hay dos columnas con la misma clave.');
  const revision = validarColumnas(columnas);
  if (revision.errores.length) throw new QuoteError(400, revision.errores.join(' '));

  if (input.tablas) {
    const clavesTabla = input.tablas.map((t) => t.clave);
    if (new Set(clavesTabla).size !== clavesTabla.length) throw new QuoteError(400, 'Hay dos tablas con la misma clave.');
    const nombres = input.tablas.map((t) => t.nombre.toLowerCase());
    if (new Set(nombres).size !== nombres.length) throw new QuoteError(400, 'Hay dos tablas con el mismo nombre.');
  }

  const ids = input.renglones.flatMap((r) => (r.id ? [r.id] : []));
  if (new Set(ids).size !== ids.length) throw new QuoteError(400, 'Un mismo renglón de renta viene dos veces.');

  return db.$transaction(async (tx) => {
    await assertCatalogo(tx, priceListId);

    const tablasAntes = await tablasDe(tx, priceListId);
    const tablas: TablaRentaDef[] = (input.tablas ?? tablasAntes).map((t) => ({ ...t, eventTypeIds: distintos(t.eventTypeIds) }));
    const tipos = await tx.eventType.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } });
    const nombreTipo = new Map(tipos.map((t) => [t.id, t.nombre]));
    const tablaDeTipo = new Map<string, string>();
    for (const t of tablas) {
      for (const et of t.eventTypeIds) {
        if (!nombreTipo.has(et)) throw new QuoteError(400, `El tipo de evento ${et} no existe.`);
        const otra = tablaDeTipo.get(et);
        if (otra) throw new QuoteError(400, `${nombreTipo.get(et)} está en dos tablas (${otra} y ${t.nombre}): va en una sola.`);
        tablaDeTipo.set(et, t.nombre);
      }
    }
    const nombreTabla = new Map(tablas.map((t) => [t.clave, t.nombre]));
    for (const r of input.renglones) {
      if (!nombreTabla.has(r.tipo)) throw new QuoteError(400, `Un renglón de renta es de una tabla que no existe (${r.tipo}).`);
    }

    const espacios = await tx.space.findMany({
      where: { id: { in: distintos(input.renglones.map((r) => r.spaceId)) } },
      select: { id: true, nombre: true },
    });
    const nombreDe = new Map(espacios.map((e) => [e.id, e.nombre]));
    for (const r of input.renglones) {
      if (!nombreDe.has(r.spaceId)) throw new QuoteError(400, `El salón ${r.spaceId} no existe.`);
    }

    // Rangos por salón y tipo de renta: sin huecos ni traslapes.
    const grupos = new Map<string, { min: number; max: number | null }[]>();
    for (const r of input.renglones) {
      const k = `${r.spaceId}|${r.tipo}`;
      grupos.set(k, [...(grupos.get(k) ?? []), { min: r.min, max: r.max }]);
    }
    for (const [k, rangos] of grupos) {
      const [spaceId, tipo] = k.split('|') as [string, string];
      const problemas = validarBrackets(rangos);
      if (problemas.length) {
        const deTabla = tablas.length > 1 ? ` (${nombreTabla.get(tipo)})` : '';
        throw new QuoteError(400, `${nombreDe.get(spaceId)}${deTabla}: ${problemas.join('; ')}.`);
      }
    }

    const actuales = await tx.rentalPrice.findMany({ where: { priceListId } });
    const actualPorId = new Map(actuales.map((r) => [r.id, r]));
    for (const id of ids) {
      if (!actualPorId.has(id)) throw new QuoteError(400, `El renglón de renta ${id} no pertenece a este catálogo.`);
    }
    const guardadas = await columnasDe(tx, priceListId);
    const columnasAntes = guardadas.length ? guardadas : [...COLUMNAS_BASE];

    // ¿Cambia la estructura? Columnas (claves y reglas) y renglones (salón, tipo, rango).
    const antesPorClave = new Map(columnasAntes.map((c) => [c.clave, c]));
    const columnasIguales =
      columnas.length === columnasAntes.length &&
      columnas.every((c) => antesPorClave.has(c.clave) && reglaDe(antesPorClave.get(c.clave)!) === reglaDe(c));
    const renglonesIguales =
      input.renglones.length === actuales.length &&
      input.renglones.every((r) => {
        const a = r.id ? actualPorId.get(r.id) : undefined;
        return a && a.spaceId === r.spaceId && a.tipo === r.tipo && a.min === r.min && a.max === r.max;
      });
    // Las tablas: cuáles hay y a qué tipos aplican. El nombre no es estructura.
    const reglaTabla = (t: TablaRentaDef) => JSON.stringify([t.clave, [...t.eventTypeIds].sort()]);
    const tablasIguales =
      tablas.length === tablasAntes.length &&
      tablas.every((t) => tablasAntes.some((a) => reglaTabla(a) === reglaTabla(t)));
    if (!columnasIguales || !renglonesIguales || !tablasIguales) {
      const uso = await contratosQueUsan(tx, { priceListId });
      if (uso.total > 0) {
        throw new QuoteError(
          409,
          `Este catálogo ya lo usan ${uso.total} evento${uso.total === 1 ? '' : 's'}: aquí solo se cambian precios y nombres de columnas y tablas. Para agregar o quitar columnas, rangos o tablas, cambiar sus días o a qué eventos aplican, crea un catálogo nuevo copiando este.`,
        );
      }
    }

    // Columnas: se reemplazan en su orden.
    await tx.columnaRenta.deleteMany({ where: { priceListId } });
    await tx.columnaRenta.createMany({
      data: columnas.map((c, orden) => ({ priceListId, ...c, orden })),
    });

    // Tablas: se reemplazan en su orden.
    await tx.tablaRenta.deleteMany({ where: { priceListId } });
    await tx.tablaRenta.createMany({
      data: tablas.map((t, orden) => ({ priceListId, clave: t.clave, nombre: t.nombre, eventTypeIds: t.eventTypeIds, orden })),
    });

    // Renglones: solo los precios de columnas que existen, y sin los vacíos.
    const preciosLimpios = (p: Record<string, number | null>) =>
      Object.fromEntries(Object.entries(p).filter(([k, v]) => v != null && claves.includes(k)));
    const quedan = new Set(ids);
    const quitados = actuales.filter((a) => !quedan.has(a.id));
    if (quitados.length) await tx.rentalPrice.deleteMany({ where: { id: { in: quitados.map((q) => q.id) } } });
    const celdas: { id: string; espacio: string; rango: string; columna: string; antes: number | null; despues: number | null }[] = [];
    const nombreColumna = new Map(columnas.map((c) => [c.clave, c.nombre]));
    let nuevos = 0;
    for (const r of input.renglones) {
      const data = { spaceId: r.spaceId, tipo: r.tipo, min: r.min, max: r.max, precios: preciosLimpios(r.precios) };
      if (r.id) {
        const antes = preciosDe(actualPorId.get(r.id)!.precios);
        for (const k of claves) {
          const [a, d] = [antes[k] ?? null, (data.precios[k] as number | undefined) ?? null];
          if (a !== d) {
            celdas.push({ id: r.id, espacio: nombreDe.get(r.spaceId)!, rango: `${r.min}–${r.max ?? '∞'}`, columna: nombreColumna.get(k)!, antes: a, despues: d });
          }
        }
        await tx.rentalPrice.update({ where: { id: r.id }, data });
      } else {
        nuevos++;
        await tx.rentalPrice.create({ data: { ...data, priceListId } });
      }
    }

    const agregadas = columnas.filter((c) => !antesPorClave.has(c.clave)).map((c) => c.nombre);
    const borradas = columnasAntes.filter((c) => !claves.includes(c.clave)).map((c) => c.nombre);
    const preciosCambiados = celdas.length;
    const clavesAntes = new Map(tablasAntes.map((t) => [t.clave, t]));
    const tablasNuevas = tablas.filter((t) => !clavesAntes.has(t.clave)).map((t) => t.nombre);
    const tablasQuitadas = tablasAntes.filter((t) => !nombreTabla.has(t.clave)).map((t) => t.nombre);
    const tablasRenombradas = tablas.filter((t) => clavesAntes.has(t.clave) && clavesAntes.get(t.clave)!.nombre !== t.nombre);
    const tablasReasignadas = tablas.filter(
      (t) => clavesAntes.has(t.clave) && reglaTabla(clavesAntes.get(t.clave)!) !== reglaTabla(t),
    );
    const partes = [
      preciosCambiados ? `${preciosCambiados} precio(s)` : null,
      agregadas.length ? `columnas nuevas: ${agregadas.join(', ')}` : null,
      borradas.length ? `columnas quitadas: ${borradas.join(', ')}` : null,
      nuevos ? `${nuevos} rango(s) nuevos` : null,
      quitados.length ? `${quitados.length} rango(s) quitados` : null,
      tablasNuevas.length ? `tablas nuevas: ${tablasNuevas.join(', ')}` : null,
      tablasQuitadas.length ? `tablas quitadas: ${tablasQuitadas.join(', ')}` : null,
      tablasRenombradas.length
        ? `tablas renombradas: ${tablasRenombradas.map((t) => `${clavesAntes.get(t.clave)!.nombre} → ${t.nombre}`).join(', ')}`
        : null,
      tablasReasignadas.length ? `cambian sus eventos: ${tablasReasignadas.map((t) => t.nombre).join(', ')}` : null,
    ].filter(Boolean);
    await registrarCambioCatalogo(
      tx,
      {
        priceListId,
        tipo: 'renta',
        descripcion: `Renta: ${partes.join(' · ') || 'sin cambios de precio'}`,
        meta: {
          columnas: columnas.map((c) => ({ ...c })),
          tablas: tablas.map((t) => ({ ...t })),
          celdas,
          renglonesNuevos: nuevos,
          renglonesQuitados: quitados.map((q) => ({ spaceId: q.spaceId, tipo: q.tipo, min: q.min, max: q.max })),
        },
      },
      actor,
    );

    // Un tipo de evento sin tabla no se puede cotizar: se guarda, pero se avisa.
    const sinTabla = tipos.filter((t) => !tablaDeTipo.has(t.id)).map((t) => t.nombre);
    const avisos = [
      ...revision.avisos,
      ...(sinTabla.length
        ? [`${sinTabla.join(', ')} ${sinTabla.length === 1 ? 'se quedó' : 'se quedaron'} sin tabla de renta: no se ${sinTabla.length === 1 ? 'podrá' : 'podrán'} cotizar con este catálogo.`]
        : []),
    ];
    return { avisos, sinTabla, preciosCambiados, renglonesNuevos: nuevos, renglonesQuitados: quitados.length };
  });
}
