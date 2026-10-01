import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Field } from '../ui.tsx';
import type { Quote } from '../../lib/types.ts';
import { Modal, mensajeDeError } from './CicloEvento.tsx';

/** Dejar el evento sin fecha: el cliente pospuso y todavía no sabe cuándo. */
export function StandbyModal({ quote, onClose, onDone }: { quote: Quote; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirmar() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/quotes/${quote.id}/standby`, { motivo: motivo.trim() });
      onDone();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo poner en standby.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal titulo="Poner en standby" onClose={onClose}>
      <p className="text-sm text-charcoal">
        El evento se queda <strong>sin fecha</strong>: el {formatEventDate(quote.fechaEvento, 'long')} se libera para
        otro evento. Sus pagos se quedan aquí y se pueden seguir registrando. Lo encuentras en{' '}
        <strong>Agenda → Sin fecha</strong> y en la lista de eventos, y vuelve con <strong>Reprogramar</strong>.
      </p>
      <Field label="Motivo">
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder="ej. Los novios esperan confirmar la fecha de la boda civil"
          className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
        />
      </Field>
      {error && <p className="text-sm text-wine">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Volver
        </Button>
        <Button variant="gold" onClick={confirmar} disabled={busy || motivo.trim().length < 3}>
          {busy ? 'Guardando…' : 'Dejar sin fecha'}
        </Button>
      </div>
    </Modal>
  );
}
