import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlarmClock } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Contador } from './ApartadoModales.tsx';
import type { ApartadoRapido } from '../../lib/types.ts';

/**
 * Los apartados que vencen en 3 días o menos: los suyos para un vendedor, todos
 * para un admin. Es el aviso en la app; el mismo día sale también por correo.
 * Con `onAbrir` cada renglón abre el apartado; sin él, lleva a la agenda.
 */
export function AvisosApartados({ onAbrir }: { onAbrir?: (a: ApartadoRapido) => void }) {
  const { data } = useQuery({
    queryKey: ['apartados-por-vencer'],
    queryFn: () => api.get<{ apartados: ApartadoRapido[] }>('/api/apartados-rapidos/por-vencer'),
    refetchInterval: 5 * 60_000,
  });
  const lista = data?.apartados ?? [];
  if (lista.length === 0) return null;
  return (
    <section aria-label="Apartados por vencer" className="mb-6 rounded-xl border border-wine/30 bg-wine/5 p-4">
      <h2 className="mb-1 inline-flex items-center gap-2 font-display text-lg text-wine">
        <AlarmClock size={18} /> {lista.length === 1 ? 'Un apartado vence pronto' : `${lista.length} apartados vencen pronto`}
      </h2>
      <p className="mb-3 text-sm text-charcoal">Confirma con la persona antes de que se libere la fecha sola.</p>
      <ul className="divide-y divide-wine/15">
        {lista.map((a) => {
          const fila = (
            <span className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left text-sm">
              <span className="min-w-0">
                <strong className="text-ink">{a.nombre}</strong>
                <span className="text-charcoal-soft">
                  {' '}· {formatEventDate(a.fecha)} · {a.eventType.nombre} · {a.posicion === 1 ? 'primero en la fila' : `lugar ${a.posicion}`}{a.telefono ? ` · ${a.telefono}` : ''}
                </span>
              </span>
              <Contador dias={a.diasRestantes} />
            </span>
          );
          return (
            <li key={a.id}>
              {onAbrir ? (
                <button type="button" onClick={() => onAbrir(a)} className="block w-full hover:bg-wine/5">
                  {fila}
                </button>
              ) : (
                <Link to={`/agenda/apartados?v=mes&d=${a.fecha}`} className="block hover:bg-wine/5">
                  {fila}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
