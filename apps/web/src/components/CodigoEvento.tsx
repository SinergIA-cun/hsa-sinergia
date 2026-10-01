import { useState } from 'react';
import { ChevronRight, Hash } from 'lucide-react';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import type { CodigoHistorial } from '../lib/types.ts';

const MOTIVO: Record<string, string> = {
  alta: 'Alta',
  fecha: 'Cambió la fecha',
  espacio: 'Cambió el salón',
  cliente: 'Cambió el cliente',
  repetido: 'Otro evento ya lo tenía',
};

/**
 * El código del evento, que es su identificador principal, con el folio interno
 * al lado y el historial de códigos a un clic.
 *
 * El historial importa porque el código cambia cuando el evento se mueve: el
 * recibo que el cliente tiene en la mano puede traer uno viejo, y aquí se ve que
 * es el mismo evento.
 */
export function CodigoEvento({
  codigo,
  folio,
  historial,
}: {
  codigo: string | null | undefined;
  folio: string;
  historial: CodigoHistorial[];
}) {
  const [abierto, setAbierto] = useState(false);
  const anteriores = historial.length - 1;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-0.5 font-mono text-[0.72rem] font-semibold tracking-tight text-cream">
        <Hash size={12} /> {codigo ?? folio}
      </span>
      <span className="font-mono text-[0.7rem] tracking-tight text-charcoal-soft">Folio {folio}</span>
      {anteriores > 0 && (
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="inline-flex items-center gap-0.5 rounded text-xs font-medium text-gold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <ChevronRight size={13} className={`transition-transform ${abierto ? 'rotate-90' : ''}`} />
          {anteriores === 1 ? '1 código anterior' : `${anteriores} códigos anteriores`}
        </button>
      )}
      {abierto && (
        <ol className="mt-1 basis-full space-y-1 rounded-lg border border-cream-300 bg-white/70 px-3 py-2">
          {[...historial].reverse().map((h, i) => (
            <li key={`${h.codigo}-${h.desde}`} className="flex flex-wrap items-baseline justify-between gap-x-4 text-xs">
              <span className={`font-mono ${i === 0 ? 'font-semibold text-ink' : 'text-charcoal-soft line-through decoration-charcoal-soft/40'}`}>
                {h.codigo}
              </span>
              <span className="text-charcoal-soft">
                {h.motivos.map((m) => MOTIVO[m] ?? m).join(' · ')} · evento el {formatEventDate(h.fechaEvento)} ·{' '}
                {formatTimestamp(h.desde)}
                {h.actor && ` · ${h.actor}`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </span>
  );
}
