/**
 * Los tipos de profesional de eventos (reunión del 15-oct-2026): la segmentación
 * que pidió el BI. El código corto es el que usan ellos (B, BG, A, WP).
 */
export const TIPOS_PROFESIONAL = ['banquetero', 'banqueteGraduacion', 'agencia', 'weddingPlanner'] as const;
export type TipoProfesional = (typeof TIPOS_PROFESIONAL)[number];

export const TIPO_PROFESIONAL: Record<TipoProfesional, { label: string; codigo: string }> = {
  banquetero: { label: 'Banquetero', codigo: 'B' },
  banqueteGraduacion: { label: 'Banquete de graduación', codigo: 'BG' },
  agencia: { label: 'Agencia', codigo: 'A' },
  weddingPlanner: { label: 'Wedding planner', codigo: 'WP' },
};

/** Un cliente directo: persona o empresa (16-oct-2026). */
export const TIPOS_CLIENTE = ['persona', 'empresa'] as const;
export type TipoCliente = (typeof TIPOS_CLIENTE)[number];

export const TIPO_CLIENTE: Record<TipoCliente, { label: string }> = {
  persona: { label: 'Cliente' },
  empresa: { label: 'Empresa' },
};
