import type { RentalPriceRow } from '../types.js';

/**
 * Cuánta gente cabe en un espacio, según sus propios rangos de renta.
 *
 * Se saca del catálogo y no de `Space.capacidadMax` a propósito: lo que decide
 * si un espacio puede cotizarse para N personas es que TENGA un rango de precio
 * para N, no un número guardado aparte que puede quedar desalineado. Un rango
 * abierto (`max: null`) significa que cabe cualquiera.
 */
export function capacidadDeEspacio(rows: readonly RentalPriceRow[]): number {
  if (rows.length === 0) return 0;
  let tope = 0;
  for (const r of rows) {
    if (r.max === null) return Number.POSITIVE_INFINITY;
    if (r.max > tope) tope = r.max;
  }
  return tope;
}

/**
 * Reparte los invitados entre los salones elegidos, en proporción a lo que cabe
 * en cada uno.
 *
 * Existe por un caso que el motor no sabía cotizar: 600 invitados en dos salones
 * de 400. Antes se buscaba el rango de renta de CADA salón con el total, así que
 * ninguno tenía precio para 600 y la cotización no se podía crear — aunque entre
 * los dos caben 800.
 *
 * **Cada salón cobra según la gente que le toca** (decisión del dueño): 600 entre
 * Arcos y Campos son 300 en cada uno, y cada uno cobra su rango de 201–300. No se
 * cobran dos salones llenos por repartir a la gente en dos.
 *
 * En proporción a la capacidad y no en partes iguales, porque partes iguales
 * rompen en cuanto los salones son de distinto tamaño: 900 personas entre La
 * Cúpula (800) y Arcos (400) serían 450 en Arcos, que no caben. Proporcional da
 * 600 y 300, que sí.
 *
 * El último absorbe el resto del redondeo, igual que `prorratearRenta`: la suma
 * de las partes tiene que ser exactamente el total.
 */
export function repartirInvitados(
  spaceIds: readonly string[],
  rentalRows: readonly RentalPriceRow[],
  invitados: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (spaceIds.length === 0) return out;
  // Un solo salón se lleva a toda la gente. Es el caso de siempre y tiene que
  // dar exactamente lo mismo que antes de que este reparto existiera.
  if (spaceIds.length === 1) {
    out.set(spaceIds[0]!, invitados);
    return out;
  }

  const capacidades = spaceIds.map((id) =>
    capacidadDeEspacio(rentalRows.filter((r) => r.spaceId === id)),
  );
  // Un rango abierto cabe con todos; para repartir se le trata como si su cupo
  // fuera el total, que es justo lo que significa.
  const finitas = capacidades.map((c) => (Number.isFinite(c) ? c : invitados));
  const suma = finitas.reduce((s, c) => s + c, 0);

  let acumulado = 0;
  spaceIds.forEach((id, i) => {
    // Al menos uno, incluido el último: un salón con cero personas no encuentra
    // rango y tumbaría la cotización entera por un redondeo. Si alguien captura
    // menos invitados que salones —un absurdo, pero capturable— cada salón
    // rentado se cotiza por una persona y las partes suman más que el total. Es
    // la única forma en que no cierran, y es preferible a no poder cotizar.
    const parte =
      i === spaceIds.length - 1
        ? Math.max(1, invitados - acumulado)
        : Math.max(1, Math.round(invitados * (suma > 0 ? finitas[i]! / suma : 1 / spaceIds.length)));
    acumulado += parte;
    out.set(id, parte);
  });
  return out;
}

/** Cuánta gente cabe entre todos los espacios elegidos. */
export function capacidadTotal(
  spaceIds: readonly string[],
  rentalRows: readonly RentalPriceRow[],
): number {
  return spaceIds.reduce(
    (s, id) => s + capacidadDeEspacio(rentalRows.filter((r) => r.spaceId === id)),
    0,
  );
}

/**
 * El rango de renta que le toca a la PARTE de un salón cuando hay varios.
 *
 * No es `findBracket`: una parte es un número que calculó el reparto, no uno que
 * alguien tecleó, y no puede tumbar la cotización por caer justo debajo del
 * mínimo del salón o en un hueco del catálogo. La Cúpula empieza en 50, así que
 * un evento chico repartido entre dos salones le podría tocar 40 — y rentar La
 * Cúpula para 40 personas cuesta su precio de entrada, no da error.
 *
 * Regla: el rango MÁS CHICO que alcance a cubrir la parte. Debajo del mínimo cae
 * en el primero (el piso de precio del salón); en un hueco, en el siguiente.
 * Arriba del cupo no hay ninguno, y ahí sí es un "no cabe" de verdad.
 *
 * El camino de UN solo salón sigue usando `findBracket` tal cual: cambiarlo
 * movería el precio de cotizaciones que hoy funcionan.
 */
export function bracketDeParte<T extends RentalPriceRow>(
  rows: readonly T[],
  parte: number,
): T | undefined {
  const exacto = rows.find((r) => parte >= r.min && (r.max === null || parte <= r.max));
  if (exacto) return exacto;
  return [...rows].sort((a, b) => a.min - b.min).find((r) => r.max === null || r.max >= parte);
}
