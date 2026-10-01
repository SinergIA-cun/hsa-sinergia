import type { PrismaClient } from '@prisma/client';

/**
 * Los nombres de los espacios: cortos, sin "Jardín" ni "Salón" (decisión del
 * dueño, 1-oct-2026). La migración `espacios_nombre_corto` renombró los que ya
 * existían; aquí quedan los anteriores para que el seed y los backfills, que
 * corren en cada arranque, los encuentren en una base que todavía no migró — y
 * nunca creen un "Salón Los Balcones" nuevo al lado de "Balcones".
 */
export const ESPACIOS = {
  arcos: { nombre: 'Arcos', anterior: 'Salón Los Arcos' },
  campos: { nombre: 'Campos', anterior: 'Jardín Los Campos' },
  cupula: { nombre: 'Cúpula', anterior: 'Jardín La Cúpula' },
  balcones: { nombre: 'Balcones', anterior: 'Salón Los Balcones' },
  pajaritos: { nombre: 'Pajaritos', anterior: 'Salón Los Pajaritos' },
} as const;

export type ClaveEspacio = keyof typeof ESPACIOS;

/** El espacio por su nombre de hoy o el de antes. */
export function buscarEspacio(prisma: PrismaClient, clave: ClaveEspacio) {
  const { nombre, anterior } = ESPACIOS[clave];
  return prisma.space.findFirst({ where: { nombre: { in: [nombre, anterior] } } });
}
