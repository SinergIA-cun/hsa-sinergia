import type { QuoteStatus } from './types.ts';

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  borrador: 'Borrador',
  formalizada: 'Formalizada',
  complementada: 'Complemento cubierto',
  liquidada: 'Liquidada',
};

export const STATUS_STYLE: Record<QuoteStatus, string> = {
  borrador: 'bg-cream-200 text-charcoal-soft',
  formalizada: 'bg-gold/25 text-gold',
  complementada: 'bg-gold text-cream',
  liquidada: 'bg-ink text-cream',
};

/** Debe seguir a `EDITABLE_STATUSES` de `apps/api/src/quotes/service.ts`. */
export const EDITABLE_STATUSES: QuoteStatus[] = ['borrador', 'formalizada', 'complementada'];
