import { useState } from 'react';
import { FORMAS_PAGO, type FormaPago } from '@hsa/shared';
import { api } from '../lib/api.ts';
import { formatEventDate } from '../lib/date.ts';
import { Button, Field, MoneyInput, TextInput } from './ui.tsx';
import { FormasPagoCampo, errorFormas, formasParaEnviar, type FormasCaptura } from './FormasPagoCampo.tsx';
import { FolioPapelCampo, folioPapelParaEnviar } from './FolioPapelCampo.tsx';
import { apiErrorMessage } from './admin/shared.tsx';
import type { Payment } from '../lib/types.ts';

// Corregir y mover un recibo ya registrado. Desde que el BI y el punto de venta
// están enlazados, el BI ya no edita: los errores de captura se corrigen aquí
// (reunión del 5-oct-2026). Son de admin y piden motivo, que queda en la bitácora.

/** La forma de pago del recibo, como la edita `FormasPagoCampo`. */
function formasDe(p: Payment): FormasCaptura {
  if (p.formas && p.formas.length > 1) {
    return {
      dividido: true,
      forma: p.formas[0]!.forma,
      partes: p.formas.map((f) => ({ forma: f.forma, monto: String(f.monto), nota: f.nota })),
    };
  }
  const una = p.formas?.[0]?.forma ?? p.metodo;
  const forma = (FORMAS_PAGO as readonly string[]).includes(una) ? (una as FormaPago) : 'transferencia';
  return { dividido: false, forma, partes: [] };
}

function Motivo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Motivo" hint="Queda en la bitácora del evento con tu usuario.">
      <TextInput value={value} onChange={(e) => onChange(e.target.value)} placeholder="ej. eran dos transferencias" />
    </Field>
  );
}

export function CorregirPagoForm({
  quoteId,
  pago,
  onListo,
  onCancelar,
}: {
  quoteId: string;
  pago: Payment;
  onListo: () => Promise<void> | void;
  onCancelar: () => void;
}) {
  const [monto, setMonto] = useState(String(pago.monto));
  const [fecha, setFecha] = useState(pago.fecha.slice(0, 10));
  const [formas, setFormas] = useState<FormasCaptura>(() => formasDe(pago));
  const [referencia, setReferencia] = useState(pago.referencia ?? '');
  const [folioPapel, setFolioPapel] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(monto);
    if (!Number.isInteger(n) || n <= 0) return setError('El monto es en pesos enteros, mayor a cero.');
    const errorDeFormas = errorFormas(formas, n);
    if (errorDeFormas) return setError(errorDeFormas);
    if (motivo.trim().length < 3) return setError('Escribe el motivo de la corrección.');
    setError('');
    setEnviando(true);
    try {
      const folio = folioPapelParaEnviar(folioPapel);
      await api.patch(`/api/quotes/${quoteId}/payments/${pago.id}/corregir`, {
        monto: n,
        fecha,
        ...formasParaEnviar(formas),
        referencia: referencia.trim() || null,
        ...(folio ? { folioPapel: folio } : {}),
        motivo: motivo.trim(),
      });
      await onListo();
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo corregir el pago.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="mt-2 grid w-full gap-3 rounded-lg border border-gold/40 bg-gold/5 p-3 sm:grid-cols-2">
      <p className="text-sm font-medium text-ink sm:col-span-2">Corregir el recibo</p>
      <Field label="Monto (MXN)">
        <MoneyInput value={monto} onValue={setMonto} />
      </Field>
      <Field label="Fecha">
        <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Field>
      <FormasPagoCampo value={formas} onChange={setFormas} monto={Number(monto) || 0} />
      <Field label="Referencia (opcional)">
        <TextInput value={referencia} onChange={(e) => setReferencia(e.target.value)} />
      </Field>
      <FolioPapelCampo value={folioPapel} onChange={setFolioPapel} />
      <Motivo value={motivo} onChange={setMotivo} />
      {error && (
        <p role="alert" className="text-sm text-wine sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="gold" className="px-3 py-1.5 text-xs" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar corrección'}
        </Button>
        <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={onCancelar}>
          Cancela
        </Button>
      </div>
    </form>
  );
}

interface EventoDestino {
  id: string;
  codigo: string;
  fecha: string;
  estatus: string;
  cliente: string | null;
}

export function MoverPagoForm({
  quoteId,
  pago,
  onListo,
  onCancelar,
}: {
  quoteId: string;
  pago: Payment;
  onListo: (destino: { id: string; codigo: string }) => Promise<void> | void;
  onCancelar: () => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [destino, setDestino] = useState<EventoDestino | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function buscar() {
    setError('');
    setDestino(null);
    if (!codigo.trim()) return;
    try {
      const r = await api.get<{ evento: EventoDestino }>(`/api/eventos/por-codigo?codigo=${encodeURIComponent(codigo.trim())}`);
      if (r.evento.id === quoteId) return setError('El pago ya está en ese evento.');
      setDestino(r.evento);
    } catch (err) {
      setError(apiErrorMessage(err, 'No hay un evento con ese código.'));
    }
  }

  async function mover(e: React.FormEvent) {
    e.preventDefault();
    if (!destino) return setError('Busca primero el evento al que va el pago.');
    if (motivo.trim().length < 3) return setError('Escribe el motivo.');
    setEnviando(true);
    try {
      const r = await api.post<{ destino: { id: string; codigo: string } }>(`/api/quotes/${quoteId}/payments/${pago.id}/mover`, {
        destino: destino.id,
        motivo: motivo.trim(),
      });
      await onListo(r.destino);
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo mover el pago.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={mover} className="mt-2 grid w-full gap-3 rounded-lg border border-gold/40 bg-gold/5 p-3">
      <p className="text-sm font-medium text-ink">Mover el recibo a otro evento</p>
      <Field label="Código del evento" hint="El vigente o uno anterior, ej. 18DIC27-NGONZALEZ-CAMPOS.">
        <div className="flex gap-2">
          <TextInput
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
              setDestino(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void buscar();
              }
            }}
          />
          <Button type="button" variant="outline" className="px-3 py-1.5 text-xs" onClick={() => void buscar()}>
            Buscar
          </Button>
        </div>
      </Field>
      {destino && (
        <p className="rounded-md bg-white/70 px-3 py-2 text-sm text-ink">
          Va a <strong>{destino.codigo}</strong>
          {destino.cliente && ` · ${destino.cliente}`} · {formatEventDate(destino.fecha)}
        </p>
      )}
      <Motivo value={motivo} onChange={setMotivo} />
      {error && (
        <p role="alert" className="text-sm text-wine">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="gold" className="px-3 py-1.5 text-xs" disabled={enviando || !destino}>
          {enviando ? 'Moviendo…' : 'Mover el pago'}
        </Button>
        <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={onCancelar}>
          Cancela
        </Button>
      </div>
    </form>
  );
}
