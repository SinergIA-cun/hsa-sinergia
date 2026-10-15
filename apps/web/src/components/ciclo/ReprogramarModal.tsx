import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Field, TextInput } from '../ui.tsx';
import type { Catalog, Quote } from '../../lib/types.ts';
import { Modal, mensajeDeError } from './CicloEvento.tsx';

interface Previa {
  antes: number;
  despues: number | null;
  ocupados: string[];
  error: string | null;
  precioPactado: boolean;
}

const mismos = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

/**
 * Mover el evento de fecha, de lugar o de los dos; también sacarlo de standby o
 * reactivarlo.
 *
 * Arranca con la fecha y los salones que ya tiene: se cambia solo lo que se
 * quiera. Antes de confirmar enseña si los salones están libres ese día y cuánto
 * queda el total (la renta depende del día y del salón), con la opción de
 * respetar el precio pactado. El número sale del servidor, del mismo cálculo que
 * guarda.
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
  const fechaActual = quote.fechaEvento.slice(0, 10);
  // Standby y cancelado sueltan la fecha: hay que volver a elegirla (aunque sea la misma).
  const recuperaFecha = quote.status === 'standby' || quote.status === 'cancelada';
  const [fecha, setFecha] = useState(recuperaFecha ? '' : fechaActual);
  const [salones, setSalones] = useState<string[]>(quote.spaceIds);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [conservar, setConservar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Liquidado o importado del BI: el precio se respeta siempre (lo exige la API).
  const precioFijo = quote.status === 'liquidada' || quote.statusPrevio === 'liquidada' || Boolean(quote.precioPactado ?? quote.importadoBI);

  const catalogQ = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Catalog>('/api/catalog') });
  // Los activos, más los que ya tiene el evento aunque se hayan desactivado.
  const opciones = (catalogQ.data?.spaces ?? []).filter((s) => s.activo || quote.spaceIds.includes(s.id));

  const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
  const cambiaFecha = fechaValida && fecha !== fechaActual;
  const cambiaLugar = salones.length > 0 && !mismos(salones, quote.spaceIds);
  const hayCambio = recuperaFecha ? fechaValida : cambiaFecha || cambiaLugar;

  useEffect(() => {
    if (!hayCambio || salones.length === 0) {
      setPrevia(null);
      return;
    }
    let vigente = true;
    api
      .post<Previa>(`/api/quotes/${quote.id}/fecha/simular`, {
        ...(fechaValida ? { fecha } : {}),
        ...(cambiaLugar ? { spaceIds: salones } : {}),
      })
      .then((p) => vigente && setPrevia(p))
      .catch(() => vigente && setPrevia(null));
    return () => {
      vigente = false;
    };
  }, [fecha, salones, hayCambio, fechaValida, cambiaLugar, quote.id]);

  const ocupado = (previa?.ocupados.length ?? 0) > 0;
  const cambiaTotal = previa?.despues != null && previa.despues !== previa.antes;

  function alternar(id: string) {
    setSalones((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function confirmar() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/quotes/${quote.id}/reprogramar`, {
        ...(recuperaFecha || cambiaFecha ? { fecha } : {}),
        ...(cambiaLugar ? { spaceIds: salones } : {}),
        conservarPrecio: conservar || precioFijo,
      });
      onDone();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo mover el evento.'));
    } finally {
      setBusy(false);
    }
  }

  const porque =
    cambiaFecha && cambiaLugar
      ? 'la renta depende del día y del salón'
      : cambiaLugar
        ? 'la renta depende del salón'
        : 'la renta depende del día de la semana';

  return (
    <Modal titulo={titulo} onClose={onClose}>
      <p className="text-sm text-charcoal">
        {quote.status === 'standby' ? 'Tenía' : 'Hoy está'} el <strong>{formatEventDate(quote.fechaEvento, 'long')}</strong>.
        Cambia la fecha, el lugar o los dos. El código del evento cambia con ellos y el anterior queda en su historial.
      </p>

      <Field label={recuperaFecha ? 'Fecha nueva' : 'Fecha'}>
        <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Field>

      <fieldset>
        <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">Lugar</legend>
        <div className="flex flex-wrap gap-2">
          {opciones.map((s) => {
            const elegido = salones.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={elegido}
                onClick={() => alternar(s.id)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  elegido ? 'border-gold bg-gold/15 text-ink' : 'border-ink/15 text-charcoal-soft hover:border-ink/30'
                }`}
              >
                {s.nombre}
              </button>
            );
          })}
        </div>
        {salones.length === 0 && <p className="mt-1 text-xs text-wine">Elige al menos un salón.</p>}
      </fieldset>

      {previa && ocupado && (
        <p className="flex items-start gap-2 rounded-lg border border-wine/30 bg-wine/10 px-3 py-2 text-sm text-wine">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {previa.ocupados.join(', ')} ya tiene un evento comprometido ese día. Elige otra fecha u otro lugar.
        </p>
      )}
      {previa?.error && <p className="text-sm text-wine">{previa.error}</p>}

      {previa && !ocupado && previa.despues != null && (
        <div className="space-y-2 rounded-lg bg-cream-200/70 px-3 py-2 text-sm text-ink">
          {precioFijo ? (
            <p>Se respeta el precio pactado: {formatMXN(previa.antes)}.</p>
          ) : cambiaTotal ? (
            <>
              <p>
                Con ese cambio el total pasa de <strong>{formatMXN(previa.antes)}</strong> a{' '}
                <strong>{formatMXN(previa.despues)}</strong>, porque {porque}.
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
        <Button variant="gold" onClick={confirmar} disabled={busy || !hayCambio || !previa || ocupado || salones.length === 0}>
          {busy ? 'Guardando…' : 'Confirmar'}
        </Button>
      </div>
    </Modal>
  );
}
