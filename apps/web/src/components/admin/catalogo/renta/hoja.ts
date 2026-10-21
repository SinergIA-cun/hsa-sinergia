import { validarBrackets, validarColumnas, type ColumnaRenta } from '@hsa/shared';
import type { RentaRenglon, TablaRentaCatalogo } from '../../../../lib/types.ts';

/**
 * El estado de la hoja de renta mientras se edita. Todo en texto: una celda
 * vacía no es cero, es "sin precio".
 */
export interface Fila {
  /** Llave estable en pantalla (el id, o una temporal para las nuevas). */
  key: string;
  id?: string;
  spaceId: string;
  espacio: string;
  /** La clave de su tabla. */
  tipo: string;
  min: string;
  max: string;
  precios: Record<string, string>;
}

export interface Hoja {
  columnas: ColumnaRenta[];
  /** Las tablas de renta en su orden, con los tipos de evento de cada una. */
  tablas: TablaRentaCatalogo[];
  filas: Fila[];
}

let consecutivo = 0;
export const claveNueva = (prefijo: string) => `${prefijo}${Date.now().toString(36)}${(consecutivo++).toString(36)}`;

export function hojaDe(renta: RentaRenglon[], columnas: ColumnaRenta[], tablas: TablaRentaCatalogo[]): Hoja {
  return {
    columnas: columnas.map((c) => ({ ...c, dias: [...c.dias], meses: [...c.meses] })),
    tablas: tablas.map((t) => ({ ...t, eventTypeIds: [...t.eventTypeIds] })),
    filas: renta.map((r) => ({
      key: r.id,
      id: r.id,
      spaceId: r.spaceId,
      espacio: r.espacio,
      tipo: r.tipo,
      min: String(r.min),
      max: r.max == null ? '' : String(r.max),
      precios: Object.fromEntries(columnas.map((c) => [c.clave, r.precios[c.clave] == null ? '' : String(r.precios[c.clave])])),
    })),
  };
}

/** "42,000" o "42000" → 42000; vacío → null; lo demás → undefined (inválido). */
export function leerPesos(v: string): number | null | undefined {
  const limpio = v.replace(/[\s,$]/g, '');
  if (limpio === '') return null;
  if (!/^\d+$/.test(limpio)) return undefined;
  return Number(limpio);
}

const leerEntero = (v: string): number | null => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

export interface Revision {
  errores: string[];
  avisos: string[];
  /** Celdas inválidas, por `${fila.key}|${clave}`. */
  celdasMalas: Set<string>;
}

export function revisar(hoja: Hoja): Revision {
  const { errores, avisos } = validarColumnas(hoja.columnas);
  const celdasMalas = new Set<string>();
  const nombreTabla = new Map(hoja.tablas.map((t) => [t.clave, t.nombre.trim()]));
  if (hoja.tablas.length === 0) errores.push('Tiene que quedar al menos una tabla de renta.');
  if (hoja.tablas.some((t) => t.nombre.trim() === '')) errores.push('Ponle nombre a cada tabla.');
  const nombres = hoja.tablas.map((t) => t.nombre.trim().toLowerCase()).filter(Boolean);
  if (new Set(nombres).size !== nombres.length) errores.push('Hay dos tablas con el mismo nombre.');
  const grupos = new Map<string, { espacio: string; tipo: string; rangos: { min: number; max: number | null }[] }>();
  for (const f of hoja.filas) {
    const min = leerEntero(f.min);
    const max = f.max.trim() === '' ? null : leerEntero(f.max);
    if (min == null || min < 1 || (f.max.trim() !== '' && max == null)) {
      errores.push(`${f.espacio}: el rango "${f.min}–${f.max}" no es válido.`);
      continue;
    }
    const k = `${f.spaceId}|${f.tipo}`;
    const g = grupos.get(k) ?? { espacio: f.espacio, tipo: f.tipo, rangos: [] };
    g.rangos.push({ min, max });
    grupos.set(k, g);
    for (const c of hoja.columnas) if (leerPesos(f.precios[c.clave] ?? '') === undefined) celdasMalas.add(`${f.key}|${c.clave}`);
  }
  for (const g of grupos.values()) {
    const p = validarBrackets(g.rangos);
    const deTabla = hoja.tablas.length > 1 ? ` (${nombreTabla.get(g.tipo) || 'tabla sin nombre'})` : '';
    if (p.length) errores.push(`${g.espacio}${deTabla}: ${p.join('; ')}.`);
  }
  if (celdasMalas.size) errores.push('Hay precios que no son pesos enteros (sin centavos).');
  return { errores, avisos, celdasMalas };
}

/** Lo que se manda a `PUT …/renta`. Solo se llama con una hoja sin errores. */
export function aPayload(hoja: Hoja) {
  return {
    columnas: hoja.columnas,
    tablas: hoja.tablas.map((t) => ({ ...t, nombre: t.nombre.trim() })),
    renglones: hoja.filas.map((f) => ({
      ...(f.id ? { id: f.id } : {}),
      spaceId: f.spaceId,
      tipo: f.tipo,
      min: Number(f.min),
      max: f.max.trim() === '' ? null : Number(f.max),
      precios: Object.fromEntries(hoja.columnas.map((c) => [c.clave, leerPesos(f.precios[c.clave] ?? '') ?? null])),
    })),
  };
}

/** Las filas ordenadas como se leen: por tipo, salón y rango. */
export function ordenar(filas: Fila[]): Fila[] {
  const n = (v: string) => Number(v) || 0;
  return [...filas].sort(
    (a, b) => a.tipo.localeCompare(b.tipo) || a.espacio.localeCompare(b.espacio) || n(a.min) - n(b.min),
  );
}

/**
 * Pega un bloque copiado de Excel (renglones con saltos de línea, celdas con
 * tabuladores) a partir de una celda, hacia la derecha y hacia abajo, dentro de
 * la misma tabla.
 */
export function pegarBloque(hoja: Hoja, filasTabla: Fila[], desdeFila: number, desdeCol: number, texto: string): Hoja {
  const bloque = texto.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
  const cambios = new Map<string, Record<string, string>>();
  bloque.forEach((celdas, i) => {
    const fila = filasTabla[desdeFila + i];
    if (!fila) return;
    const nuevos = { ...(cambios.get(fila.key) ?? fila.precios) };
    celdas.forEach((v, j) => {
      const col = hoja.columnas[desdeCol + j];
      if (col) nuevos[col.clave] = v.trim();
    });
    cambios.set(fila.key, nuevos);
  });
  return { ...hoja, filas: hoja.filas.map((f) => (cambios.has(f.key) ? { ...f, precios: cambios.get(f.key)! } : f)) };
}
