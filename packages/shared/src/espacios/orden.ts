/**
 * El orden de los salones en TODAS las pantallas: Cúpula, Arcos, Campos y,
 * debajo, Balcones y Pajaritos ("SIEMPRE va: Cúpula, Arcos y luego Campos", el
 * dueño, 5-oct-2026). Antes salían por orden alfabético, que con los nombres
 * cortos (sin "Jardín"/"Salón") revolvía el orden de siempre.
 */
const ORDEN = ['cupula', 'arcos', 'campos', 'balcones', 'pajaritos'] as const;

const sinAcentos = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** 0 = Cúpula … 4 = Pajaritos; un salón nuevo que no esté en la lista va al final. */
export function prioridadEspacio(nombre: string): number {
  const n = sinAcentos(nombre);
  const i = ORDEN.findIndex((o) => n.includes(o));
  return i === -1 ? ORDEN.length : i;
}

/** Una copia de los espacios en el orden de la hacienda (los nuevos, por nombre). */
export function ordenarEspacios<T extends { nombre: string }>(espacios: readonly T[]): T[] {
  return [...espacios].sort(
    (a, b) => prioridadEspacio(a.nombre) - prioridadEspacio(b.nombre) || a.nombre.localeCompare(b.nombre, 'es'),
  );
}
