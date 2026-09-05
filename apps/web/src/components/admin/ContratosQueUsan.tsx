import { Link } from 'react-router-dom';
import { ExternalLink, Trash2 } from 'lucide-react';
import { formatEventDate } from '../../lib/date.ts';
import { STATUS_LABEL } from '../../lib/status.ts';
import type { ContratoQueUsa, QuoteStatus, UsoEnContratos } from '../../lib/types.ts';

/**
 * Los contratos que impiden borrar algo, con nombre y liga.
 *
 * Existe porque "en uso por 1 contrato" sin decir cuál convierte un borrado en
 * una búsqueda a mano entre cientos. Con tres datos —cliente, código y fecha— y
 * una liga, el bloqueo deja de ser un misterio.
 *
 * Con muchos, la lista completa no ayudaría más que la muestra: el remedio sigue
 * siendo desactivar el servicio. Lo que sí importa es que el número sea cierto.
 */
export function ContratosQueUsan({ uso }: { uso: UsoEnContratos }) {
  const ocultos = uso.total - uso.muestra.length;

  return (
    <div className="mt-1 w-full max-w-sm rounded-lg border border-wine/25 bg-wine/5 p-2.5 text-left">
      <ul className="space-y-1">
        {uso.muestra.map((c) => (
          <Renglon key={c.id} c={c} />
        ))}
      </ul>
      {ocultos > 0 && (
        <p className="mt-1.5 text-[0.7rem] text-charcoal-soft">
          y {ocultos} más. Desactivarlo los deja a todos intactos.
        </p>
      )}
    </div>
  );
}

function Renglon({ c }: { c: ContratoQueUsa }) {
  return (
    <li>
      <Link
        to={c.enPapelera ? '/papelera' : `/cotizaciones/${c.id}`}
        className="group flex items-start justify-between gap-2 rounded px-1.5 py-1 hover:bg-white/70"
      >
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-ink">{c.cliente}</span>
          <span className="block font-mono text-[0.65rem] text-charcoal-soft">
            {c.folio ?? formatEventDate(c.fechaEventoISO)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {/* Un contrato en la papelera no sale en ninguna lista: sin decirlo, la
              búsqueda sería infinita y el bloqueo inexplicable. */}
          {c.enPapelera ? (
            <span className="inline-flex items-center gap-1 rounded bg-ink/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-charcoal-soft">
              <Trash2 size={9} /> papelera
            </span>
          ) : (
            <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-charcoal-soft">
              {STATUS_LABEL[c.status as QuoteStatus] ?? c.status}
            </span>
          )}
          <ExternalLink size={11} className="mt-0.5 text-charcoal-soft group-hover:text-ink" />
        </span>
      </Link>
    </li>
  );
}
