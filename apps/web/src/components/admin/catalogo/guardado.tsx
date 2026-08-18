import { useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '../../ui.tsx';
import { apiErrorMessage } from '../shared.tsx';

/**
 * El estado de guardar UNA sección del catálogo.
 *
 * Vive aquí y no en cada sección porque las cinco necesitan exactamente lo
 * mismo —pendiente, error legible, confirmación— y cinco copias divergen al
 * primer ajuste.
 */
export function useGuardar(fallback: string) {
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function correr(fn: () => Promise<unknown>, mensajeOk: string): Promise<boolean> {
    setPendiente(true);
    setError('');
    setOk('');
    try {
      await fn();
      setOk(mensajeOk);
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, fallback));
      return false;
    } finally {
      setPendiente(false);
    }
  }

  return { correr, pendiente, error, ok, limpiar: () => { setError(''); setOk(''); } };
}

/**
 * La barra de guardado de una sección.
 *
 * Se guarda POR SECCIÓN a propósito: una tabla de 37 renglones guardada entera
 * deja una bitácora que dice "se editó la renta" sin decir qué, y ese renglón no
 * sirve para reconstruir nada. `cambios` es cuántos renglones se van a mandar.
 */
export function BarraGuardar({
  cambios,
  pendiente,
  error,
  ok,
  onGuardar,
  onDescartar,
  etiqueta = 'Guardar',
  unidad = 'cambio',
}: {
  cambios: number;
  pendiente: boolean;
  error: string;
  ok: string;
  onGuardar: () => void;
  onDescartar: () => void;
  etiqueta?: string;
  unidad?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-cream-300 pt-3">
      <Button
        type="button"
        variant="gold"
        className="px-3 py-1.5 text-xs"
        disabled={pendiente || cambios === 0}
        onClick={onGuardar}
      >
        <Save size={13} /> {pendiente ? 'Guardando…' : etiqueta}
      </Button>
      {cambios > 0 && (
        <>
          <span className="text-xs text-charcoal-soft">
            {cambios} {unidad}
            {cambios === 1 ? '' : 's'} sin guardar
          </span>
          <Button
            type="button"
            variant="ghost"
            className="px-2.5 py-1.5 text-xs"
            disabled={pendiente}
            onClick={onDescartar}
          >
            Descartar
          </Button>
        </>
      )}
      {error && (
        <span role="alert" className="text-xs text-wine">
          {error}
        </span>
      )}
      {ok && !error && <span className="text-xs text-emerald-700">{ok}</span>}
    </div>
  );
}
