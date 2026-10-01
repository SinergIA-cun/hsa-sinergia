import type { CapacityBracket } from '../types.js';

/**
 * Valida que un juego de rangos cubra a todo el mundo sin traslape y sin hueco.
 * Devuelve la lista de problemas; vacía significa válido.
 *
 * Es una regla de NEGOCIO, no de transporte, y por eso vive aquí junto a
 * `findBracket`: un hueco entre rangos no falla al guardar, falla meses después
 * cuando alguien captura ese número de invitados y el motor lanza "no tiene rango
 * para N invitados". El único momento en que se puede atajar es al escribirlo.
 *
 * El orden en que llegan no importa: se ordenan por `min` antes de comparar.
 */
export function validarBrackets(brackets: readonly CapacityBracket[]): string[] {
  const problemas: string[] = [];
  if (brackets.length === 0) {
    return ['Un paquete necesita al menos un rango de invitados con precio'];
  }

  for (const b of brackets) {
    if (!Number.isInteger(b.min) || b.min < 1) {
      problemas.push(`El mínimo del rango (${b.min}) debe ser un entero de 1 o más`);
    }
    if (b.max !== null && !Number.isInteger(b.max)) {
      problemas.push(`El máximo del rango (${b.max}) debe ser un entero o quedar abierto`);
    }
    if (b.max !== null && Number.isInteger(b.max) && b.max < b.min) {
      problemas.push(`El rango ${b.min}–${b.max} termina antes de empezar`);
    }
  }

  const orden = [...brackets].sort((a, b) => a.min - b.min);
  for (const [i, actual] of orden.entries()) {
    const siguiente = orden[i + 1];
    if (!siguiente) continue;
    if (actual.max === null) {
      // `findBracket` devuelve el PRIMER rango que contiene al invitado: un rango
      // abierto en medio deja inalcanzable todo lo que viene después.
      problemas.push(`Solo el último rango puede quedar abierto; ${actual.min}+ no lo es`);
      continue;
    }
    if (siguiente.min <= actual.max) {
      problemas.push(
        `Los rangos ${actual.min}–${actual.max} y ${siguiente.min}–${siguiente.max ?? '∞'} se traslapan`,
      );
    } else if (siguiente.min > actual.max + 1) {
      problemas.push(
        `Queda un hueco sin precio entre ${actual.max + 1} y ${siguiente.min - 1} invitados`,
      );
    }
  }

  return problemas;
}

export function findBracket<T extends CapacityBracket>(
  rows: T[],
  invitados: number,
): T | undefined {
  return rows.find(
    (r) => invitados >= r.min && (r.max === null || invitados <= r.max),
  );
}

/**
 * Personas extra en vez de brincar de nivel.
 *
 * La práctica de la hacienda: un evento de 110 personas no paga el nivel de
 * 101–200 completo, paga el de 100 más 10 personas extra. El catálogo dice hasta
 * cuántas personas por encima del tope de un nivel se cobra así (`tolerancia`);
 * pasando de ahí, ya se cobra el nivel siguiente.
 *
 * Recibe el rango que contiene al invitado y devuelve el que se COBRA: el mismo
 * (sin extras) o el anterior —el que termina justo antes— con cuántas personas
 * le sobran. Con `tolerancia` 0 es exactamente `findBracket`.
 */
export function nivelConExtras<T extends CapacityBracket>(
  rows: readonly T[],
  rango: T,
  invitados: number,
  tolerancia: number,
): { row: T; extras: number } {
  if (!(tolerancia > 0)) return { row: rango, extras: 0 };
  const anterior = rows.find((r) => r.max != null && r.max === rango.min - 1);
  if (!anterior || anterior.max == null) return { row: rango, extras: 0 };
  const extras = invitados - anterior.max;
  if (extras <= 0 || extras > tolerancia) return { row: rango, extras: 0 };
  return { row: anterior, extras };
}
