import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { apiErrorMessage } from '../admin/shared.tsx';
import { formatTimestamp } from '../../lib/date.ts';
import { Button, Field, TextInput } from '../ui.tsx';
import type { Quote } from '../../lib/types.ts';

const CERRABLES = new Set(['formalizada', 'complementada', 'liquidada', 'cancelada']);

/**
 * "Cerrar evento" (reunión del 15-oct-2026). Ya conciliado, el admin lo cierra
 * y nada del evento se puede cambiar —ni pagos, ni cargos, ni datos— hasta que
 * un admin lo reabra con motivo. Facturar sí se puede.
 */
export function CierreEvento({ quote, isAdmin }: { quote: Quote; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<'cerrar' | 'reabrir' | null>(null);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cerrado = Boolean(quote.cerradoAt);

  async function enviar() {
    setError('');
    setBusy(true);
    try {
      if (abierto === 'cerrar') await api.post(`/api/quotes/${quote.id}/cerrar`, texto.trim() ? { nota: texto.trim() } : {});
      else await api.post(`/api/quotes/${quote.id}/reabrir`, { motivo: texto.trim() });
      setAbierto(null);
      setTexto('');
      await qc.invalidateQueries({ queryKey: ['quote', quote.id] });
      await qc.invalidateQueries({ queryKey: ['agenda'] });
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo.'));
    } finally {
      setBusy(false);
    }
  }

  if (!cerrado && !(isAdmin && CERRABLES.has(quote.status))) return null;

  return (
    <div className={`mb-6 rounded-xl border px-4 py-3 ${cerrado ? 'border-ink/30 bg-ink/[0.06]' : 'border-cream-300 bg-white/60'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {cerrado ? (
          <p className="inline-flex items-center gap-2 text-sm text-ink">
            <Lock size={16} />
            <span>
              <strong>Evento cerrado</strong>
              {quote.cerradoAt && ` el ${formatTimestamp(quote.cerradoAt)}`}
              {quote.cerradoBy && ` por ${quote.cerradoBy.nombre}`}. Nada se puede cambiar; facturar sí.
            </span>
          </p>
        ) : (
          <p className="text-sm text-charcoal-soft">¿Ya se concilió? Ciérralo para que nadie lo cambie por error.</p>
        )}
        {isAdmin && abierto === null && (
          <Button variant="outline" onClick={() => setAbierto(cerrado ? 'reabrir' : 'cerrar')}>
            {cerrado ? <><LockOpen size={15} /> Reabrir</> : <><Lock size={15} /> Cerrar evento</>}
          </Button>
        )}
      </div>
      {abierto && (
        <div className="mt-3 space-y-2">
          <Field label={abierto === 'cerrar' ? 'Nota (opcional)' : '¿Por qué se reabre?'}>
            <TextInput autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={abierto === 'cerrar' ? 'ej. conciliado con el BI' : 'ej. faltó registrar un cargo'} />
          </Field>
          {error && <p role="alert" className="text-sm text-wine">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || (abierto === 'reabrir' && texto.trim().length < 3)} onClick={() => void enviar()}>
              {abierto === 'cerrar' ? 'Cerrar el evento' : 'Reabrir el evento'}
            </Button>
            <Button variant="ghost" onClick={() => { setAbierto(null); setTexto(''); setError(''); }}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
