import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarOff } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import type { EventoSinFecha } from '../lib/types.ts';

/**
 * Los eventos en standby: los que hoy no tienen fecha. "Si se pone en standby,
 * en alguna parte deben quedar" (el dueño): aquí, arriba de la agenda, porque es
 * donde se busca una fecha nueva para ellos.
 */
export function SinFechaPanel() {
  const { data } = useQuery({
    queryKey: ['sin-fecha'],
    queryFn: () => api.get<{ eventos: EventoSinFecha[] }>('/api/quotes/sin-fecha'),
  });
  const eventos = data?.eventos ?? [];
  if (eventos.length === 0) return null;

  return (
    <section aria-labelledby="sin-fecha-titulo" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <h2 id="sin-fecha-titulo" className="flex items-center gap-2 font-display text-lg text-amber-900">
        <CalendarOff size={17} /> Sin fecha · en standby
        <span className="rounded-full bg-amber-900/10 px-2 py-0.5 font-sans text-xs font-semibold">{eventos.length}</span>
      </h2>
      <ul className="mt-2 divide-y divide-amber-200">
        {eventos.map((e) => (
          <li key={e.quoteId}>
            <Link
              to={`/eventos/${e.quoteId}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-sm hover:bg-amber-100/60"
            >
              <span>
                <span className="font-medium text-ink">{e.cliente}</span>
                <span className="text-charcoal-soft"> · {e.eventoNombre}</span>
                {e.codigo && <span className="ml-2 font-mono text-[0.7rem] text-charcoal-soft">{e.codigo}</span>}
              </span>
              <span className="text-xs text-charcoal-soft">
                tenía el {formatEventDate(e.fechaQueTenia)}
                {e.standbyDesde && ` · sin fecha desde ${formatTimestamp(e.standbyDesde)}`}
                {e.motivo && ` · ${e.motivo}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
