/**
 * Búsqueda de texto tolerante para listas de gente.
 *
 * Aquí se escribe "Barrera" y el registro dice "Bárrera", o al revés. Sin
 * quitar los acentos el buscador falla justo en los apellidos mexicanos que
 * más se repiten (Muñoz, Rodríguez, Ramírez) y quien busca concluye que el
 * banquetero no existe y lo da de alta otra vez.
 */
export function normaliza(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * ¿Los campos, juntos, contienen lo buscado? Cada palabra del término debe
 * aparecer, en cualquier orden: "carlos ban" encuentra a "Banquetes Carlos".
 */
export function coincide(campos: (string | null | undefined)[], termino: string): boolean {
  const heno = normaliza(campos.filter(Boolean).join(' '));
  return normaliza(termino)
    .split(/\s+/)
    .filter(Boolean)
    .every((palabra) => heno.includes(palabra));
}
