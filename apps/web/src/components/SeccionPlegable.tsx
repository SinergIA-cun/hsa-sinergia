import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from './ui.tsx';
import { cn } from '../lib/cn.ts';

/**
 * Una sección del formulario del evento que se pliega (22-oct-2026): ya llena,
 * se minimiza para ahorrar espacio y deja ver un resumen de una línea. Plegada
 * sigue montada (solo se oculta), así que nada de lo capturado se pierde.
 */
export function SeccionPlegable({
  titulo,
  resumen,
  abiertaAlInicio = true,
  className,
  children,
}: {
  titulo: string;
  /** Lo que se ve junto al título cuando está plegada. */
  resumen?: ReactNode;
  abiertaAlInicio?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [abierta, setAbierta] = useState(abiertaAlInicio);
  const id = useId();
  return (
    <Card className={cn('p-6', className)}>
      <button
        type="button"
        aria-expanded={abierta}
        aria-controls={id}
        onClick={() => setAbierta((a) => !a)}
        className="group -m-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        <h2 className="font-display text-xl text-ink">{titulo}</h2>
        {!abierta && resumen && <span className="min-w-0 flex-1 truncate text-sm text-charcoal-soft">{resumen}</span>}
        <ChevronDown
          size={18}
          className={cn(
            'ml-auto shrink-0 text-charcoal-soft transition-transform duration-200 group-hover:text-ink',
            abierta && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      <div id={id} hidden={!abierta} className="mt-4 space-y-4">
        {children}
      </div>
    </Card>
  );
}
