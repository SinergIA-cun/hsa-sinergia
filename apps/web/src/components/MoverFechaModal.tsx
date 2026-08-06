import { AlertTriangle } from 'lucide-react';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Button, Card } from './ui.tsx';

interface Props {
  cliente: string;
  fechaOrigen: string;
  fechaDestino: string;
  totalActual: number;
  totalNuevo: number | null;
  pagado: number;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmación de un arrastre en la agenda. Muestra el cambio de precio porque
 * la renta depende del tipo de día: mover un sábado a un martes puede bajar el
 * total decenas de miles de pesos, y quien arrastra debe verlo antes de soltar.
 */
export function MoverFechaModal({
  cliente, fechaOrigen, fechaDestino, totalActual, totalNuevo, pagado, busy, error, onCancel, onConfirm,
}: Props) {
  const cambia = totalNuevo != null && totalNuevo !== totalActual;
  const bajaDeLoPagado = totalNuevo != null && totalNuevo < pagado;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-md space-y-4 p-6">
        <h2 className="font-display text-xl text-ink">Mover evento</h2>
        <p className="text-sm text-charcoal">
          Mover <strong>{cliente}</strong> del {formatEventDate(fechaOrigen, 'long')} al{' '}
          <strong>{formatEventDate(fechaDestino, 'long')}</strong>.
        </p>

        {cambia && (
          <p className="rounded-lg bg-cream-200/70 px-3 py-2 text-sm text-ink">
            El total cambia de <strong>{formatMXN(totalActual)}</strong> a{' '}
            <strong>{formatMXN(totalNuevo!)}</strong>, porque la renta depende del día de la semana.
          </p>
        )}
        {!cambia && totalNuevo != null && (
          <p className="text-sm text-charcoal-soft">El total no cambia: {formatMXN(totalActual)}.</p>
        )}

        {bajaDeLoPagado && (
          <p className="flex items-start gap-2 rounded-lg border border-wine/30 bg-wine/10 px-3 py-2 text-sm text-wine">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              El total nuevo queda por debajo de lo ya pagado ({formatMXN(pagado)}). El evento
              quedará marcado con desfase para que alguien lo resuelva.
            </span>
          </p>
        )}

        {error && <p className="text-sm text-wine">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button variant="gold" onClick={onConfirm} disabled={busy}>
            {busy ? 'Moviendo…' : 'Mover'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
