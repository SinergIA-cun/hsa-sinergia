import type { QuoteStatus } from './types.ts';

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  formalizada: 'Formalizada',
  complementada: 'Complemento cubierto',
  liquidada: 'Liquidada',
  vencida: 'Vencida',
};

export const STATUS_STYLE: Record<QuoteStatus, string> = {
  borrador: 'bg-cream-200 text-charcoal-soft',
  enviada: 'bg-ink/10 text-ink',
  aceptada: 'bg-gold/15 text-gold',
  formalizada: 'bg-gold/25 text-gold',
  complementada: 'bg-gold text-cream',
  liquidada: 'bg-ink text-cream',
  vencida: 'bg-wine/10 text-wine',
};

export const EDITABLE_STATUSES: QuoteStatus[] = ['borrador', 'enviada', 'aceptada', 'formalizada', 'complementada'];
