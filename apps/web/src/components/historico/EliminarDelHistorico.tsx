import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { Button, Field } from '../ui.tsx';
import { Modal, mensajeDeError } from '../ciclo/CicloEvento.tsx';

/**
 * Quitar del Histórico un evento que fue de prueba. Solo lo ve un admin.
 *
 * Va a la papelera, no se borra: se puede restaurar 30 días y después la purga
 * lo elimina con sus pagos y cargos. El motivo queda en la bitácora.
 */
export function EliminarDelHistorico({ quoteId, cliente }: { quoteId: string; cliente: string }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function eliminar() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/admin/historico/${quoteId}/eliminar`, { motivo: motivo.trim() });
      setAbierto(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['historico'] }),
        qc.invalidateQueries({ queryKey: ['quotes'] }),
        qc.invalidateQueries({ queryKey: ['trash-sin-ver'] }),
      ]);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo eliminar.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 text-xs text-wine underline hover:text-wine/80"
      >
        <Trash2 size={13} /> Eliminar (fue de prueba)
      </button>
      {abierto && (
        <Modal titulo="Eliminar del Histórico" onClose={() => setAbierto(false)}>
          <p className="text-sm text-charcoal">
            El evento de <strong>{cliente}</strong> deja de aparecer en el Histórico, Eventos, la Agenda, el
            tablero y el BI, junto con sus pagos y cargos.
          </p>
          <p className="text-sm text-charcoal-soft">
            Queda 30 días en la Papelera por si fue un error; después se borra para siempre.
          </p>
          <Field label="Motivo">
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              maxLength={300}
              autoFocus
              placeholder="ej. Evento de prueba capturado al configurar el sistema"
              className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
            />
          </Field>
          {error && <p className="text-sm text-wine">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAbierto(false)} disabled={busy}>
              Volver
            </Button>
            <Button
              variant="gold"
              onClick={eliminar}
              disabled={busy || motivo.trim().length < 3}
              className="bg-wine hover:bg-wine/90"
            >
              {busy ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
