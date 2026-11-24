/**
 * Qué lista de precios le toca a una fecha de evento (24-nov-2026).
 *
 * La administración "casa" periodos de fechas con listas: todo 2027 → "2027",
 * diciembre de 2028 → "Temporada alta 2028". Al cotizar, la fecha decide la
 * lista y ventas ya no tiene que escogerla (escoger la incorrecta era el error).
 *
 * Reglas:
 * - Los extremos cuentan: un periodo 2027-01-01 → 2027-12-31 incluye ambos días.
 * - Si varios periodos contienen la fecha, gana el MÁS CORTO: es el más
 *   específico (un mes de temporada dentro de un año completo).
 * - Empate de largo con listas distintas = conflicto. No se adivina: la pantalla
 *   lo dice y la persona elige.
 * - Sin periodo, la regla de antes: si hay un solo catálogo del año, ése.
 *
 * Las fechas viajan como `YYYY-MM-DD`; comparar textos así equivale a comparar
 * fechas y evita cualquier corrimiento de zona horaria.
 */

export interface PeriodoLista {
  id: string;
  priceListId: string;
  /** `YYYY-MM-DD`, incluido. */
  desde: string;
  /** `YYYY-MM-DD`, incluido. */
  hasta: string;
  nota?: string | null;
}

export interface CatalogoConAnio {
  id: string;
  anio: number;
}

export type ListaDeLaFecha =
  | { motivo: 'periodo'; priceListId: string; periodoId: string }
  | { motivo: 'anio'; priceListId: string }
  | { motivo: 'conflicto'; priceListIds: string[] };

const DIA_MS = 86_400_000;

/** Días que abarca un periodo (para escoger el más específico). */
export function diasDePeriodo(p: Pick<PeriodoLista, 'desde' | 'hasta'>): number {
  return Math.round((Date.parse(`${p.hasta}T00:00:00Z`) - Date.parse(`${p.desde}T00:00:00Z`)) / DIA_MS) + 1;
}

export function listaParaFecha(
  fecha: string,
  periodos: readonly PeriodoLista[],
  catalogos: readonly CatalogoConAnio[],
): ListaDeLaFecha | undefined {
  const dia = fecha.slice(0, 10);
  if (dia.length !== 10) return undefined;

  const existentes = new Set(catalogos.map((c) => c.id));
  const contienen = periodos.filter((p) => existentes.has(p.priceListId) && p.desde <= dia && dia <= p.hasta);

  if (contienen.length > 0) {
    const minimo = Math.min(...contienen.map(diasDePeriodo));
    const empatados = contienen.filter((p) => diasDePeriodo(p) === minimo);
    const listas = [...new Set(empatados.map((p) => p.priceListId))];
    if (listas.length > 1) return { motivo: 'conflicto', priceListIds: listas };
    const elegido = empatados[0]!;
    return { motivo: 'periodo', priceListId: elegido.priceListId, periodoId: elegido.id };
  }

  const anio = Number(dia.slice(0, 4));
  const delAnio = catalogos.filter((c) => c.anio === anio);
  return delAnio.length === 1 ? { motivo: 'anio', priceListId: delAnio[0]!.id } : undefined;
}
