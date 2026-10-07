import { Plus, Trash2 } from 'lucide-react';
import { MoneyInput, TextInput } from './ui.tsx';
import type { ServicioBanqueteroInput } from '../lib/types.ts';

/**
 * Lo que pone el banquetero en su evento (el banquete, la mesa de quesos…).
 *
 * Es para saber qué se vendió, no para cobrar: no entra al desglose ni al total,
 * que es lo que el evento le debe a la hacienda. El monto —lo que cobra el
 * banquetero— es opcional.
 */
export function ServiciosBanqueteroCampo({
  servicios,
  onChange,
}: {
  servicios: ServicioBanqueteroInput[];
  onChange: (s: ServicioBanqueteroInput[]) => void;
}) {
  const actualizar = (i: number, patch: Partial<ServicioBanqueteroInput>) =>
    onChange(servicios.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-2 border-t border-cream-300 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">Lo que pone el banquetero</span>
        <span className="text-xs text-charcoal-soft">
          Solo para registro: <span className="font-medium">no suma al total</span> del evento.
        </span>
      </div>

      {servicios.map((s, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-ink/10 px-3 py-2.5 sm:grid-cols-[1fr_6rem_9rem_auto]">
          <TextInput
            value={s.nombre}
            onChange={(e) => actualizar(i, { nombre: e.target.value })}
            placeholder="Ej.: banquete 3 tiempos"
            aria-label="Qué pone el banquetero"
          />
          <TextInput
            type="number"
            min={1}
            step={1}
            value={String(s.cantidad)}
            onChange={(e) => actualizar(i, { cantidad: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
            aria-label="Cantidad"
          />
          <MoneyInput
            value={s.monto == null ? '' : String(s.monto)}
            onValue={(v) => actualizar(i, { monto: v.trim() === '' ? null : Math.trunc(Number(v) || 0) })}
            placeholder="Monto (opcional)"
            aria-label="Lo que cobra el banquetero"
          />
          <button
            type="button"
            onClick={() => onChange(servicios.filter((_, j) => j !== i))}
            aria-label={`Quitar ${s.nombre || 'el renglón'}`}
            className="self-center justify-self-end rounded-md p-1.5 text-charcoal-soft transition-colors hover:bg-wine/10 hover:text-wine"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...servicios, { nombre: '', cantidad: 1, monto: null }])}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-ink/25 px-3 py-2 text-sm text-charcoal-soft transition-colors hover:border-gold hover:text-ink"
      >
        <Plus size={15} /> Agregar lo que pone el banquetero
      </button>
    </div>
  );
}
