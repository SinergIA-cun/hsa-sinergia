import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { normalizaTexto } from '@hsa/shared';
import { MoneyInput, SelectInput, TextInput } from './ui.tsx';
import { formatMXN } from '../lib/money.ts';
import { api } from '../lib/api.ts';

/** Proveedor y comisión de un servicio: lo que le paga a la hacienda (% o monto, uno u otro). */
export interface DatosComision {
  proveedor?: string | null;
  comisionPct?: number | null;
  comisionMonto?: number | null;
}

type Modo = 'ninguna' | 'pct' | 'monto';

const IVA = 1.16;

/**
 * Quién da un servicio y cuánto le paga a la hacienda (11-nov-2026: el grupo
 * musical de un evento). La comisión es en % del subtotal sin IVA o en monto
 * fijo. La usan los servicios del evento y los cargos del punto de venta.
 */
export function ComisionServicio({
  valor,
  base,
  onChange,
  disabled = false,
}: {
  valor: DatosComision;
  /** Lo que cuesta el servicio, con IVA: para decir cuánto deja el porcentaje. */
  base: number;
  onChange: (patch: DatosComision) => void;
  disabled?: boolean;
}) {
  const listaId = useId();
  // Prof. Evento: si el proveedor es uno de ellos, el BI lo recibe como agencia
  // (con su id) y, sin comisión capturada, con la de su ficha.
  const { data } = useQuery({
    queryKey: ['banqueteros'],
    queryFn: () => api.get<{ banqueteros: { id: string; nombre: string; comisionPct?: number }[] }>('/api/banqueteros'),
    staleTime: 5 * 60_000,
  });
  const profesionales = data?.banqueteros ?? [];
  const ligado = valor.proveedor
    ? profesionales.find((p) => normalizaTexto(p.nombre) === normalizaTexto(valor.proveedor!))
    : undefined;
  const modo: Modo = valor.comisionMonto != null ? 'monto' : valor.comisionPct != null ? 'pct' : 'ninguna';
  const deja =
    modo === 'monto' ? valor.comisionMonto! : modo === 'pct' ? Math.round((base / IVA) * valor.comisionPct!) / 100 : null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-ink/10 pt-2 sm:col-span-full">
      <TextInput
        value={valor.proveedor ?? ''}
        onChange={(e) => onChange({ proveedor: e.target.value || null })}
        placeholder="Proveedor (opcional)"
        aria-label="Proveedor del servicio"
        list={listaId}
        className="min-w-[11rem] flex-1 sm:max-w-64"
        disabled={disabled}
      />
      <datalist id={listaId}>
        {profesionales.map((p) => (
          <option key={p.id} value={p.nombre} />
        ))}
      </datalist>
      <SelectInput
        value={modo}
        onChange={(e) => {
          const m = e.target.value as Modo;
          onChange(
            m === 'pct'
              ? { comisionPct: valor.comisionPct ?? 10, comisionMonto: null }
              : m === 'monto'
                ? { comisionMonto: valor.comisionMonto ?? 0, comisionPct: null }
                : { comisionPct: null, comisionMonto: null },
          );
        }}
        aria-label="Comisión para la hacienda"
        className="w-44"
        disabled={disabled}
      >
        <option value="ninguna">Sin comisión</option>
        <option value="pct">Comisión en %</option>
        <option value="monto">Comisión en monto</option>
      </SelectInput>
      {modo === 'pct' && (
        <TextInput
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={String(valor.comisionPct ?? '')}
          onChange={(e) => onChange({ comisionPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
          aria-label="Porcentaje de comisión"
          className="w-24"
          disabled={disabled}
        />
      )}
      {modo === 'monto' && (
        <MoneyInput
          value={valor.comisionMonto ? String(valor.comisionMonto) : ''}
          onValue={(v) => onChange({ comisionMonto: Number(v) || 0 })}
          placeholder="Monto"
          aria-label="Monto de la comisión"
          className="w-32"
          disabled={disabled}
        />
      )}
      {deja != null && deja > 0 && (
        <span className="text-xs text-charcoal-soft">
          Le deja a la hacienda <span className="font-medium text-ink">{formatMXN(deja)}</span>
        </span>
      )}
      {ligado && (
        <span className="w-full text-xs text-emerald-700">
          De Prof. Evento: el BI lo ve como agencia
          {modo === 'ninguna' && ligado.comisionPct != null ? `, con la comisión de su ficha (${ligado.comisionPct}%)` : ''}.
        </span>
      )}
    </div>
  );
}
