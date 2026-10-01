import { useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { Button, Field } from './ui.tsx';

/** Debe seguir a `NOTAS_MAX` de `apps/api/src/payments/notas.ts`. */
export const NOTAS_MAX = 1000;

const textareaCls =
  'w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30';

/**
 * El campo "Notas" al registrar dinero: "cualquier cosa que ayude a entender el
 * pago" (el dueño). Son internas: el cliente no las ve en su página ni en el recibo.
 */
export function NotasCampo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Notas (opcional)" hint="Internas: el cliente no las ve.">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={NOTAS_MAX}
        placeholder="ej. Pagó la mamá de la novia · el cheque se cobra el lunes"
        className={textareaCls}
      />
    </Field>
  );
}

/**
 * Las notas de un pago ya registrado, con su edición en el renglón. Se pueden
 * agregar o corregir después: muchas veces lo que explica un pago se sabe días
 * más tarde (un cheque que rebotó, quién hizo la transferencia).
 */
export function NotasEditables({
  notas,
  editable,
  onGuardar,
}: {
  notas: string | null | undefined;
  editable: boolean;
  onGuardar: (notas: string | null) => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(notas ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function guardar() {
    setBusy(true);
    setError('');
    try {
      await onGuardar(texto.trim() === '' ? null : texto.trim());
      setEditando(false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'No se pudieron guardar las notas.');
    } finally {
      setBusy(false);
    }
  }

  if (editando) {
    return (
      <div className="basis-full space-y-2 pt-1">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          maxLength={NOTAS_MAX}
          autoFocus
          aria-label="Notas del pago"
          className={textareaCls}
        />
        {error && <p className="text-xs text-wine">{error}</p>}
        <div className="flex gap-2">
          <Button variant="primary" onClick={guardar} disabled={busy} className="px-3 py-1.5 text-xs">
            {busy ? 'Guardando…' : 'Guardar notas'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setTexto(notas ?? '');
              setEditando(false);
            }}
            disabled={busy}
            className="px-3 py-1.5 text-xs"
          >
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  if (!notas && !editable) return null;
  return (
    <div className="flex basis-full items-start gap-2 text-xs">
      {notas && (
        <p className="flex-1 whitespace-pre-line rounded-md bg-cream-100 px-2 py-1 text-charcoal">
          <NotebookPen size={12} className="mr-1 inline text-gold" aria-hidden />
          {notas}
        </p>
      )}
      {editable && (
        <button
          type="button"
          onClick={() => {
            setTexto(notas ?? '');
            setEditando(true);
          }}
          className="shrink-0 py-1 font-medium text-gold hover:underline"
        >
          {notas ? 'Editar notas' : '+ Notas'}
        </button>
      )}
    </div>
  );
}
