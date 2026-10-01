import { useState } from 'react';
import { calcularCancelacion, PORCENTAJES_DEVOLUCION } from '@hsa/shared';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Field, TextInput } from '../ui.tsx';
import { FormasPagoCampo, errorFormas, formasIniciales, formasParaEnviar } from '../FormasPagoCampo.tsx';
import type { Quote } from '../../lib/types.ts';
import { Modal, mensajeDeError } from './CicloEvento.tsx';

/**
 * Cancelar el evento y decidir qué pasa con el dinero: se devuelve el 100%, una
 * parte, o nada. La devolución se puede registrar aquí mismo o después (la
 * pantalla del evento dice cuánto falta devolver).
 */
export function CancelarEventoModal({
  quote,
  pagado,
  onClose,
  onDone,
}: {
  quote: Quote;
  pagado: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [porcentaje, setPorcentaje] = useState<number>(100);
  const [otro, setOtro] = useState(false);
  const [devolverAhora, setDevolverAhora] = useState(false);
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [formas, setFormas] = useState(() => formasIniciales());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pctValido = Number.isFinite(porcentaje) && porcentaje >= 0 && porcentaje <= 100;
  const c = pctValido ? calcularCancelacion(pagado, porcentaje) : null;
  const conDinero = pagado > 0;
  const registrar = conDinero && devolverAhora && (c?.devolver ?? 0) > 0;

  async function confirmar() {
    if (conDinero && !c) return;
    setError('');
    if (registrar && c) {
      const errorDeFormas = errorFormas(formas, c.devolver);
      if (errorDeFormas) {
        setError(errorDeFormas);
        return;
      }
    }
    setBusy(true);
    try {
      await api.post(`/api/quotes/${quote.id}/cancelar`, {
        motivo: motivo.trim(),
        porcentaje: conDinero ? porcentaje : 0,
        ...(registrar ? { devolucion: { fecha, ...formasParaEnviar(formas) } } : {}),
      });
      onDone();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo cancelar el evento.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal titulo="Cancelar evento" onClose={onClose}>
      <p className="text-sm text-charcoal">
        El {formatEventDate(quote.fechaEvento, 'long')} se libera para otro evento. Un admin puede reactivarlo
        después si la fecha sigue libre.
      </p>

      <Field label="Motivo">
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="ej. Cambio de planes de la familia"
          className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
        />
      </Field>

      {conDinero ? (
        <fieldset className="space-y-3">
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
            ¿Qué pasa con lo pagado? ({formatMXN(pagado)})
          </legend>
          <div className="flex flex-wrap gap-2">
            {PORCENTAJES_DEVOLUCION.map((p) => (
              <OpcionPct
                key={p}
                activo={!otro && porcentaje === p}
                onClick={() => {
                  setOtro(false);
                  setPorcentaje(p);
                }}
              >
                {p === 100 ? 'Devolver todo' : p === 0 ? 'No se devuelve' : `Devolver ${p}%`}
              </OpcionPct>
            ))}
            <OpcionPct activo={otro} onClick={() => setOtro(true)}>
              Otro %
            </OpcionPct>
          </div>
          {otro && (
            <label className="flex items-center gap-2 text-sm">
              <TextInput
                type="number"
                min={0}
                max={100}
                step={1}
                value={Number.isFinite(porcentaje) ? porcentaje : ''}
                onChange={(e) => setPorcentaje(e.target.value === '' ? Number.NaN : Number(e.target.value))}
                className="w-24"
                aria-label="Porcentaje a devolver"
              />
              % de lo pagado se devuelve
            </label>
          )}

          {c ? (
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-cream-200/70 px-3 py-2 text-sm">
              <div>
                <dt className="text-xs text-charcoal-soft">Se le devuelve</dt>
                <dd className="text-lg font-semibold tabular-nums text-ink">{formatMXN(c.devolver)}</dd>
              </div>
              <div>
                <dt className="text-xs text-charcoal-soft">Se retiene</dt>
                <dd className="text-lg font-semibold tabular-nums text-ink">{formatMXN(c.retenido)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-wine">El porcentaje va de 0 a 100.</p>
          )}

          {c && c.devolver > 0 && (
            <div className="space-y-3 rounded-lg border border-cream-300 p-3">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={devolverAhora}
                  onChange={(e) => setDevolverAhora(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-gold)]"
                />
                Ya se le devolvió: registrarlo ahora
              </label>
              {devolverAhora ? (
                <>
                  <Field label="Fecha de la devolución">
                    <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                  </Field>
                  <FormasPagoCampo value={formas} onChange={setFormas} monto={c.devolver} />
                </>
              ) : (
                <p className="text-xs text-charcoal-soft">
                  Si se devuelve después, queda como pendiente en el evento y se registra en Devoluciones.
                </p>
              )}
            </div>
          )}
        </fieldset>
      ) : (
        <p className="text-sm text-charcoal-soft">No tiene pagos: no hay dinero que devolver.</p>
      )}

      {error && <p className="text-sm text-wine">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Volver
        </Button>
        <Button
          variant="gold"
          onClick={confirmar}
          disabled={busy || motivo.trim().length < 3 || (conDinero && !c)}
          className="bg-wine hover:bg-wine/90"
        >
          {busy ? 'Cancelando…' : 'Cancelar evento'}
        </Button>
      </div>
    </Modal>
  );
}

function OpcionPct({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${
        activo ? 'border-ink bg-ink text-cream' : 'border-ink/15 bg-white/70 text-ink hover:border-ink/40'
      }`}
    >
      {children}
    </button>
  );
}
