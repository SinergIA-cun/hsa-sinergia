/**
 * Un color por espacio, para poder distinguirlos de un vistazo.
 *
 * La matriz de renta son decenas de renglones donde lo único que cambia entre
 * bloques es el nombre del salón. Al editar, es fácil teclear el precio del
 * rango correcto en el salón equivocado. Una banda de color por salón convierte
 * esa lectura en algo que se resuelve con la periferia del ojo.
 *
 * El color NO sale de una lista de nombres: los espacios son datos y el cliente
 * puede dar de alta otro mañana. Sale del id, así que un espacio nuevo recibe su
 * color solo, y el mismo espacio se ve igual en toda la aplicación y entre
 * sesiones.
 *
 * La paleta se queda dentro de la marca —marino, dorado, vino, verde y terracota
 * apagados— y todos los tonos son claros: son fondos detrás de texto, no
 * acentos. El contraste del texto lo pone `text-ink`, que sobre estos fondos
 * cumple de sobra.
 */

export interface ColorEspacio {
  /** Fondo suave para la celda del nombre. */
  fondo: string;
  /** Barra lateral que agrupa visualmente los renglones del mismo espacio. */
  barra: string;
  /** Punto de color para leyendas y chips. */
  punto: string;
}

/**
 * Seis tonos. Con más de seis espacios se repiten, y está bien: el color agrupa,
 * no identifica — el nombre sigue ahí al lado.
 */
const PALETA: ColorEspacio[] = [
  { fondo: 'bg-[#eef2f7]', barra: 'bg-[#14304d]', punto: 'bg-[#14304d]' }, // marino
  { fondo: 'bg-[#f6efe1]', barra: 'bg-[#b0894e]', punto: 'bg-[#b0894e]' }, // dorado
  { fondo: 'bg-[#eaf1ec]', barra: 'bg-[#4a7c59]', punto: 'bg-[#4a7c59]' }, // verde jardín
  { fondo: 'bg-[#f7eef0]', barra: 'bg-[#7a2f3a]', punto: 'bg-[#7a2f3a]' }, // vino
  { fondo: 'bg-[#f4eee9]', barra: 'bg-[#9c6644]', punto: 'bg-[#9c6644]' }, // terracota
  { fondo: 'bg-[#edf0f2]', barra: 'bg-[#4a6572]', punto: 'bg-[#4a6572]' }, // pizarra
];

/**
 * Suma de los códigos de la cadena. No necesita ser un buen hash: solo necesita
 * dar SIEMPRE el mismo número para la misma entrada, y repartir razonablemente
 * entre seis cubetas.
 */
function indice(clave: string): number {
  let suma = 0;
  for (let i = 0; i < clave.length; i++) suma = (suma + clave.charCodeAt(i) * (i + 1)) % 100000;
  return suma % PALETA.length;
}

export function colorEspacio(spaceId: string): ColorEspacio {
  return PALETA[indice(spaceId)]!;
}
