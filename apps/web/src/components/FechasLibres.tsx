import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarSearch } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatEventDate } from '../lib/date.ts';

/**
 * "Arcos ocupado · ver fechas libres": el mismo día de la semana libre en las
 * semanas de alrededor (reunión del 15-oct-2026). Se pide al tocarlo, no antes:
 * un día con tres salones ocupados no tiene por qué hacer tres consultas.
 */
export function FechasLibres({
  fecha,
  spaceIds,
  etiqueta,
  excludeQuoteId,
  onElegir,
}: {
  fecha: string;
  spaceIds: string[];
  etiqueta: string;
  excludeQuoteId?: string;
  onElegir: (fecha: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const { data, isFetching } = useQuery({
    queryKey: ['fechas-libres', fecha, spaceIds.join(','), excludeQuoteId],
    queryFn: () =>
      api.get<{ fechas: string[] }>(
        `/api/availability/sugerencias?fecha=${fecha}&spaceIds=${spaceIds.join(',')}` +
          (excludeQuoteId ? `&excludeQuoteId=${excludeQuoteId}` : ''),
      ),
    enabled: abierto,
  });
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="inline-flex items-center gap-1.5 font-medium text-gold underline-offset-2 hover:underline"
      >
        <CalendarSearch size={13} /> {etiqueta} ocupado · ver fechas libres
      </button>
      {abierto && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {isFetching && <span className="text-charcoal-soft">Buscando…</span>}
          {!isFetching && (data?.fechas.length ?? 0) === 0 && (
            <span className="text-charcoal-soft">No hay ese día de la semana libre en los próximos meses.</span>
          )}
          {data?.fechas.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onElegir(f)}
              className="rounded-full border border-gold/50 bg-gold/10 px-3 py-1 font-medium text-ink hover:bg-gold/25"
            >
              {formatEventDate(f)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
