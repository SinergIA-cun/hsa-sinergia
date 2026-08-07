import { AlertTriangle } from 'lucide-react';
import { formatEventDate } from '../lib/date.ts';
import { Button, Card } from './ui.tsx';

/** Un espacio ya comprometido ese día, con quién lo tiene. */
export interface EspacioOcupado {
  nombre: string;
  clientes: string[];
}

interface Props {
  fecha: string;
  estatusLabel: string;
  ocupados: EspacioOcupado[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Aviso —no candado— al apartar una fecha que ya está comprometida.
 *
 * El pago del cliente siempre se registra: negarse a registrar dinero que ya
 * entró es peor que un empalme visible. El empalme se resuelve hablando; el
 * dinero sin registro no aparece en ningún lado. Por eso el botón de confirmar
 * existe y no hay forma de que la API rechace el cambio.
 */
export function ConfirmarEmpalmeModal({
  fecha, estatusLabel, ocupados, busy, error, onCancel, onConfirm,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-md space-y-4 p-6">
        <h2 className="flex items-center gap-2 font-display text-xl text-wine">
          <AlertTriangle size={18} className="shrink-0" /> La fecha ya está apartada
        </h2>

        <div className="space-y-2 text-sm text-charcoal">
          <p>
            El <strong>{formatEventDate(fecha, 'long')}</strong> estos espacios ya están
            comprometidos:
          </p>
          <ul className="space-y-1 rounded-lg bg-wine/[0.06] px-3 py-2">
            {ocupados.map((o) => (
              <li key={o.nombre}>
                <strong>{o.nombre}</strong>
                {o.clientes.length > 0 && <> · {o.clientes.join(', ')}</>}
              </li>
            ))}
          </ul>
          <p>
            Pasar a <strong>{estatusLabel}</strong> de todos modos deja dos eventos comprometidos
            el mismo día. Habrá que mover a uno de fecha o devolverle su dinero.
          </p>
        </div>

        {error && <p className="text-sm text-wine">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button variant="gold" onClick={onConfirm} disabled={busy}>
            {busy ? 'Guardando…' : 'Apartar de todos modos'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
