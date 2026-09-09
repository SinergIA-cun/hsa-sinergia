/**
 * Bandas de color por grupo, como las filas de una hoja de cálculo.
 *
 * La matriz de renta son decenas de renglones donde lo único que cambia entre
 * bloques es el salón. Al editar es fácil teclear el precio del rango correcto
 * en el salón equivocado, porque nada separa un bloque del siguiente.
 *
 * La primera versión de esto le daba un color distinto a cada salón, sacado de
 * un hash del id. Funcionaba y era peor: seis tonos compitiendo entre sí, y el
 * color puesto solo detrás del nombre, así que no separaba los BLOQUES —que es
 * lo que hay que separar—. La forma que la gente ya conoce de un Excel es más
 * simple: un bloque con fondo, el siguiente sin fondo, el siguiente con fondo.
 * Un solo tono, encendido y apagado.
 *
 * Es POSICIONAL a propósito. La banda no identifica al salón —para eso está su
 * nombre, en cada renglón—: solo dice dónde empieza uno y dónde acaba el otro.
 */

/**
 * Para cada renglón, si va con fondo o sin fondo.
 *
 * La banda cambia cuando cambia la clave, no cada renglón: los cuatro rangos de
 * un mismo salón comparten fondo y por eso se leen como un bloque. El primer
 * grupo va SIN fondo, para que la tabla arranque igual que su encabezado.
 */
export function bandasDeGrupo(claves: readonly string[]): boolean[] {
  let grupo = -1;
  let anterior: string | null = null;
  return claves.map((clave) => {
    if (clave !== anterior) {
      grupo += 1;
      anterior = clave;
    }
    return grupo % 2 === 1;
  });
}
