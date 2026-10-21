/**
 * Los tipos de profesional de eventos (reunión del 15-oct-2026): la segmentación
 * que pidió el BI. El código corto es el que usan ellos (B, BG, A, WP).
 */
export const TIPOS_PROFESIONAL = ['banquetero', 'banqueteGraduacion', 'agencia', 'weddingPlanner', 'otro'] as const;
export type TipoProfesional = (typeof TIPOS_PROFESIONAL)[number];

export const TIPO_PROFESIONAL: Record<TipoProfesional, { label: string; codigo: string }> = {
  banquetero: { label: 'Banquetero', codigo: 'B' },
  banqueteGraduacion: { label: 'Banquete de graduación', codigo: 'BG' },
  agencia: { label: 'Agencia', codigo: 'A' },
  weddingPlanner: { label: 'Wedding planner', codigo: 'WP' },
  otro: { label: 'Otro', codigo: 'O' },
};

/** La comisión de HSA por omisión (21-oct-2026), en % del subtotal de alimentos. */
export const COMISION_HSA_POR_OMISION = 10;

/**
 * La comisión de HSA de un evento: la de su agencia o su cliente profesional,
 * si tiene; si no, la que se puso en el evento (o la de por omisión).
 */
export function comisionDelEvento(q: {
  comisionPct?: number | null;
  agencia?: { nombre: string; comisionPct: number } | null;
  banquetero?: { nombre: string; comisionPct: number } | null;
}): { pct: number; fuente: 'cliente' | 'evento'; de: string | null } {
  const quien = q.agencia ?? q.banquetero ?? null;
  if (quien) return { pct: quien.comisionPct, fuente: 'cliente', de: quien.nombre };
  return { pct: q.comisionPct ?? COMISION_HSA_POR_OMISION, fuente: 'evento', de: null };
}

/** Un cliente directo: persona o empresa (16-oct-2026). */
export const TIPOS_CLIENTE = ['persona', 'empresa'] as const;
export type TipoCliente = (typeof TIPOS_CLIENTE)[number];

export const TIPO_CLIENTE: Record<TipoCliente, { label: string }> = {
  persona: { label: 'Cliente' },
  empresa: { label: 'Empresa' },
};
