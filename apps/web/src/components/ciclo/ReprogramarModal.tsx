import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Field, TextInput } from '../ui.tsx';
import type { Quote } from '../../lib/types.ts';
import { Modal, mensajeDeError } from './CicloEvento.tsx';

interface Previa {
  antes: number;
  despues: number | null;
  ocupados: string[];
  error: string | null;
  precioPactado: boolean;
}

/**
 * Ponerle fecha nueva al evento: moverlo, sacarlo de standby o reactivarlo.
 *
 * Antes de confirmar enseña si el salón está libre ese día y cuánto queda el
 * total (la renta depende del día de la semana), con la opción de respetar el
 * precio pactado. El número sale del servidor, del mismo cálculo que guarda.
 */
export function ReprogramarModal({
  quote,
  titulo,
  onClose,
  onDone,
}: {
  quote: Quote;
  titulo: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fecha, setFecha] = useState('');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [conservar, setConservar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Liquidado o importado del BI: el precio se respeta siempre (lo exige la API).
  const precioFijo = quote.status === 'liquidada' || quote.statusPrevio === 'liquidada' || Boolean(quote.importadoBI);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      setPrevia(null);
      return;
    }
    let vigente = true;
    api
      .post<Previa>(`/api/quotes/${quote.id}/fecha/simular`, { fecha })
      .then((p) => vigente && setPrevia(p))
      .catch(() => vigente && setPrevia(null));
    return () => {
      vigente = false;
    };
  }, [fecha, quote.id]);

  const ocupado = (previa?.ocupados.length ?? 0) > 0;
  const cambia = previa?.despues != null && previa.despues !== previa.antes;

  async function confirmar() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/quotes/${quote.id}/reprogramar`, { fecha, conservarPrecio: conservar || precioFijo });
      onDone();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo cambiar la fecha.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal titulo={titulo} onClose={onClose}>
      <p className="text-sm text-charcoal">
        {quote.status === 'standby' ? 'Tenía' : 'Hoy está'} el <strong>{formatEventDate(quote.fechaEvento, 'long')}</strong>.
        El código del evento cambia con la fecha y el anterior queda en su historial.
      </p>
      <Field label="Fecha nueva">
        <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Field>

      {previa && ocupado && (
        <p className="flex items-start gap-2 rounded-lg border border-wine/30 bg-wine/10 px-3 py-2 text-sm text-wine">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {previa.ocupados.join(', ')} ya tiene un evento comprometido ese día. Elige otra fecha.
        </p>
      )}
      {previa?.error && <p className="text-sm text-wine">{previa.error}</p>}

      {previa && !ocupado && previa.despues != null && (
        <div className="space-y-2 rounded-lg bg-cream-200/70 px-3 py-2 text-sm text-ink">
          {precioFijo ? (
            <p>Se respeta el precio pactado: {formatMXN(previa.antes)}.</p>
          ) : cambia ? (
            <>
              <p>
                Con esa fecha el total pasa de <strong>{formatMXN(previa.antes)}</strong> a{' '}
                <strong>{formatMXN(previa.despues)}</strong>, porque la renta depende del día de la semana.
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={conservar}
                  onChange={(e) => setConservar(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-gold)]"
                />
                Respetar el precio pactado ({formatMXN(previa.antes)})
              </label>
            </>
          ) : (
            <p>El total no cambia: {formatMXN(previa.antes)}.</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-wine">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Volver
        </Button>
        <Button variant="gold" onClick={confirmar} disabled={busy || !previa || ocupado}>
          {busy ? 'Guardando…' : 'Confirmar fecha'}
        </Button>
      </div>
    </Modal>
  );
}
