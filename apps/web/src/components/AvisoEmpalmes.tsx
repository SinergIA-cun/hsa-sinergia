import { Link } from 'react-router-dom';
import { CalendarX2 } from 'lucide-react';
import { useDesplazadas } from '../lib/desplazadas.ts';
import { formatEventDate } from '../lib/date.ts';

/**
 * Cotizaciones que perdieron su fecha porque otra apartó el mismo espacio.
 *
 * No se puede descartar a propósito: el aviso desaparece cuando el vendedor
 * mueve la fecha o cancela la cotización, no cuando decide ignorarlo. Va al
 * principio del panel porque es lo primero que hay que resolver en el día:
 * o se mueve al cliente de fecha, o se le devuelve su dinero.
 */
export function AvisoEmpalmes() {
  const { data } = useDesplazadas();
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="dash-noprint" aria-labelledby="empalmes-title">
      <h2
        id="empalmes-title"
        className="mb-1 flex items-center gap-2 font-display text-2xl text-wine"
      >
        <CalendarX2 size={18} />
        {items.length === 1
          ? 'Una cotización perdió su fecha'
          : `${items.length} cotizaciones perdieron su fecha`}
      </h2>
      <p className="mb-3 text-sm text-charcoal-soft">
        El espacio ya quedó apartado por otro evento. Hay que moverlas de fecha o avisarle al
        cliente y devolverle su dinero.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((d) => (
          <li key={d.id}>
            <Link
              to={`/cotizaciones/${d.id}`}
              className="block rounded-[var(--radius-card)] border-l-4 border-wine bg-wine/[0.04] p-4 transition-colors hover:bg-wine/[0.08]"
            >
              <p className="truncate font-medium text-ink">{d.clienteNombre}</p>
              <p className="text-xs text-charcoal-soft">
                Evento {formatEventDate(d.fechaEvento, 'long')}
              </p>
              <p className="mt-1 truncate text-[0.7rem] font-semibold text-wine">
                Apartada por {d.bloqueadaPor.clienteNombre}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
