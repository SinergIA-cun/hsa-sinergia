/**
 * Texto normalizado para buscar: minúsculas, sin acentos, sin espacios de sobra.
 *
 * Aquí se escribe "Muñoz" y se busca "munoz", o al revés. Sin quitar los acentos
 * el buscador falla justo en los apellidos mexicanos que más se repiten y quien
 * busca concluye que el registro no existe.
 *
 * Vive en `shared` porque los dos lados lo necesitan y tienen que coincidir: la
 * API guarda el texto ya normalizado en la columna `busqueda` del histórico, y
 * la web normaliza lo que se teclea antes de mandarlo. Dos implementaciones
 * parecidas en dos paquetes distintos serían dos búsquedas que discrepan.
 */
export function normalizaTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿Los campos, juntos, contienen lo buscado? Cada palabra del término debe
 * aparecer, en cualquier orden: "carlos ban" encuentra a "Banquetes Carlos".
 */
export function coincideTexto(campos: (string | null | undefined)[], termino: string): boolean {
  const heno = normalizaTexto(campos.filter(Boolean).join(' '));
  return normalizaTexto(termino)
    .split(' ')
    .filter(Boolean)
    .every((palabra) => heno.includes(palabra));
}
