/**
 * Cuánto dura una fecha apartada: 7 días hábiles, contados solos.
 *
 * Antes la vigencia se capturaba a mano en el formulario. Un plazo que cada
 * quien teclea no es un plazo: es una negociación por apartado, imposible de
 * sostener igual para todos y de explicarle a un banquetero por qué al suyo le
 * tocaron cinco días y al otro treinta.
 *
 * Siete días hábiles desde el día en que se aparta. Apartas un viernes y te
 * quedan los cinco de la semana siguiente más el lunes y el martes de la otra:
 * vence el martes.
 *
 * El día que devuelve es el ÚLTIMO en que el apartado sigue vivo, no el primero
 * en que ya murió — `apartadoVivo` compara con `>=`. Si te tocan siete días
 * hábiles, el séptimo todavía es tuyo.
 *
 * Todo en UTC a medianoche, que es como esta base guarda los días civiles.
 */

const DIA_MS = 86_400_000;

const utc = (a: number, m: number, d: number): number => Date.UTC(a, m, d);

/** El n-ésimo lunes de un mes, en milisegundos UTC. */
function lunesNumero(anio: number, mes: number, n: number): number {
  const primero = new Date(utc(anio, mes, 1));
  // 0 = domingo, 1 = lunes. Cuánto falta del día 1 para caer en lunes.
  const alPrimerLunes = (8 - primero.getUTCDay()) % 7;
  return utc(anio, mes, 1 + alPrimerLunes + (n - 1) * 7);
}

/**
 * Los días de descanso obligatorio del artículo 74 de la Ley Federal del
 * Trabajo, del año que se le pida.
 *
 * Se calculan por REGLA y no se listan a mano: una tabla de fechas hay que
 * recordar actualizarla cada año, y el año que nadie se acuerde los apartados
 * empiezan a vencer en día festivo sin que nadie note por qué.
 *
 * Desde la reforma de 2006 tres de ellos se recorren al lunes, así que el 5 de
 * febrero de 2027 —que cae en viernes— NO es el día de descanso: lo es el lunes
 * 1. Por eso son reglas y no fechas fijas.
 *
 * No entran el 2 de noviembre, el 12 de diciembre ni el Viernes Santo: se
 * trabajan, aunque mucha gente los sienta festivos. Ésta es la lista de la ley.
 */
export function descansosObligatorios(anio: number): Set<number> {
  const dias = [
    utc(anio, 0, 1), // Año Nuevo
    lunesNumero(anio, 1, 1), // primer lunes de febrero — Constitución
    lunesNumero(anio, 2, 3), // tercer lunes de marzo — natalicio de Juárez
    utc(anio, 4, 1), // Día del Trabajo
    utc(anio, 8, 16), // Independencia
    lunesNumero(anio, 10, 3), // tercer lunes de noviembre — Revolución
    utc(anio, 11, 25), // Navidad
  ];
  // Transmisión del Poder Ejecutivo: cada seis años, el 1 de octubre desde 2024.
  if (anio >= 2024 && (anio - 2024) % 6 === 0) dias.push(utc(anio, 9, 1));
  return new Set(dias);
}

/** ¿Se trabaja este día? Ni sábado, ni domingo, ni descanso obligatorio. */
export function esDiaHabil(dia: Date): boolean {
  const d = dia.getUTCDay();
  if (d === 0 || d === 6) return false;
  return !descansosObligatorios(dia.getUTCFullYear()).has(dia.getTime());
}

/**
 * Suma `cuantos` días hábiles a partir de `desde`, sin contar `desde`.
 *
 * El día de partida no cuenta aunque sea hábil: quien aparta un viernes a las
 * seis de la tarde no tuvo ese viernes para nada. Contar desde el día siguiente
 * es lo que hace que el plazo sea de verdad siete días.
 */
export function sumarDiasHabiles(desde: Date, cuantos: number): Date {
  let cursor = desde.getTime();
  let restantes = cuantos;
  while (restantes > 0) {
    cursor += DIA_MS;
    if (esDiaHabil(new Date(cursor))) restantes -= 1;
  }
  return new Date(cursor);
}

/** Los días hábiles que dura un apartado nuevo. */
export const DIAS_HABILES_APARTADO = 7;

/**
 * Hasta cuándo vive un apartado que se crea hoy.
 *
 * Es la única fuente del plazo: la API la usa al crear y la pantalla la usa para
 * decirle al vendedor qué día va a quedar ANTES de guardar. Si cada una lo
 * calculara por su cuenta, tarde o temprano dirían cosas distintas.
 */
export function vigenciaDeApartado(desde: Date): Date {
  return sumarDiasHabiles(desde, DIAS_HABILES_APARTADO);
}
