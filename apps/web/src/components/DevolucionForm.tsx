import { useState, type FormEvent } from 'react';
import { formatMXN } from '../lib/money.ts';
import { Button, Field, MoneyInput, SelectInput, TextInput } from './ui.tsx';
import { FormasPagoCampo, errorFormas, formasIniciales, formasParaEnviar } from './FormasPagoCampo.tsx';
import { apiErrorMessage } from './admin/shared.tsx';

/**
 * Registrar una devolución: "si un cliente pagó un monto de más, poder devolverle
 * y que se marque" (el dueño). Sirve igual para un cliente y para un banquetero;
 * quien lo usa decide a dónde se manda y con qué opciones (`destinos`).
 *
 * El servidor pone el tope (no se devuelve más de lo que entró); aquí solo se
 * sugiere el monto y se avisa antes de mandar.
 */
export function DevolucionForm({
  sugerido,
  maximo,
  destinos,
  onEnviar,
  onCerrar,
}: {
  /** Monto con el que arranca (el excedente, si lo hay). */
  sugerido: number;
  /** Lo máximo que se puede devolver, para avisar antes de que el servidor lo rechace. */
  maximo: number;
  /** De dónde puede salir, si hay más de una opción ("la renta" / "la cuenta del evento"). */
  destinos?: { valor: string; etiqueta: string; maximo: number }[];
  onEnviar: (cuerpo: Record<string, unknown>) => Promise<void>;
  onCerrar: () => void;
}) {
  const [destino, setDestino] = useState(destinos?.[0]?.valor ?? '');
  const [monto, setMonto] = useState(sugerido > 0 ? String(sugerido) : '');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [formas, setFormas] = useState(() => formasIniciales());
  const [motivo, setMotivo] = useState('');
  const [referencia, setReferencia] = useState('');
  const [uuid, setUuid] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const tope = destinos?.find((d) => d.valor === destino)?.maximo ?? maximo;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    const n = Number(monto);
    if (!(n > 0)) return setError('Captura cuánto se devuelve.');
    if (n > tope) return setError(`Solo se pueden devolver hasta ${formatMXN(tope)}: es lo que entró.`);
    if (motivo.trim().length < 3) return setError('Escribe el motivo: es lo que se va a leer después.');
    const errorDeFormas = errorFormas(formas, n);
    if (errorDeFormas) return setError(errorDeFormas);
    setBusy(true);
    try {
      await onEnviar({
        monto: n,
        fecha,
        motivo: motivo.trim(),
        referencia: referencia.trim() || undefined,
        notaCreditoUuid: uuid.trim() || null,
        ...(destino ? { destino } : {}),
        ...formasParaEnviar(formas),
      });
      onCerrar();
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo registrar la devolución.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mt-4 grid gap-3 rounded-lg border border-wine/25 bg-wine/[0.04] p-4 sm:grid-cols-2">
      {destinos && destinos.length > 1 && (
        <Field label="Se devuelve de">
          <SelectInput value={destino} onChange={(e) => setDestino(e.target.value)}>
            {destinos.map((d) => (
              <option key={d.valor} value={d.valor}>
                {d.etiqueta} (hasta {formatMXN(d.maximo)})
              </option>
            ))}
          </SelectInput>
        </Field>
      )}
      <Field label="Monto a devolver" hint={`Hasta ${formatMXN(tope)}.`}>
        <MoneyInput value={monto} onValue={setMonto} />
      </Field>
      <Field label="Fecha en que salió el dinero">
        <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Field>
      <FormasPagoCampo value={formas} onChange={setFormas} monto={Number(monto) || 0} />
      <div className="sm:col-span-2">
        <Field label="Motivo">
          <TextInput value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ej. Pagó de más en el finiquito" />
        </Field>
      </div>
      <Field label="Referencia (opcional)">
        <TextInput value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="ej. SPEI 0043128" />
      </Field>
      <Field label="Nota de crédito (UUID, opcional)" hint="Si el pago ya estaba facturado. Se puede anotar después.">
        <TextInput value={uuid} onChange={(e) => setUuid(e.target.value)} placeholder="11111111-2222-…" />
      </Field>
      {error && <p className="text-sm text-wine sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Registrar devolución'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCerrar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
