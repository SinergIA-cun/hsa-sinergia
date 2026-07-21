import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError } from '../../lib/api.ts';
import { Button } from '../ui.tsx';

/** Extrae un mensaje legible de un error de API, con respaldo. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}

/**
 * Botón de borrado en dos pasos (sin window.confirm). Ejecuta `onConfirm` y, si
 * el backend lo bloquea (409 "en uso"), muestra el motivo junto al botón.
 */
export function ConfirmDelete({
  onConfirm,
  disabled,
  label = 'Borrar',
}: {
  onConfirm: () => Promise<unknown>;
  disabled?: boolean;
  label?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setPending(true);
    setError('');
    try {
      await onConfirm();
      setArmed(false);
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo borrar.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {armed ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            className="px-2.5 py-1.5 text-xs"
            disabled={pending}
            onClick={() => { setArmed(false); setError(''); }}
          >
            Cancela
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="bg-wine px-2.5 py-1.5 text-xs text-cream hover:bg-wine/90"
            disabled={pending}
            onClick={run}
          >
            {pending ? 'Borrando…' : 'Sí, borrar'}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="px-2.5 py-1.5 text-xs text-wine hover:bg-wine/10"
          disabled={disabled}
          onClick={() => setArmed(true)}
          aria-label={label}
        >
          <Trash2 size={14} /> {label}
        </Button>
      )}
      {error && (
        <span role="alert" className="max-w-[15rem] text-right text-xs text-wine">
          {error}
        </span>
      )}
    </div>
  );
}
