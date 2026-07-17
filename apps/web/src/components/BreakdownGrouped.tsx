import type { QuoteBreakdown, QuoteLine } from '@hsa/shared';
import { formatMXN, formatMXNCents } from '../lib/money.ts';

interface Props {
  breakdown: QuoteBreakdown;
  /** Reetiqueta conceptos (p. ej. "Renta arcos" → "Renta Salón Los Arcos"). */
  lineLabel?: (concepto: string) => string;
}

interface BloqueProps {
  titulo: string;
  nota: string;
  lines: QuoteLine[];
  subtotal: number;
  iva: number;
  total: number;
  totalLabel: string;
  lineLabel: (concepto: string) => string;
  className?: string;
}

/** Un bloque de cobro autocontenido: conceptos + subtotal + IVA + total propio. */
function Bloque({ titulo, nota, lines, subtotal, iva, total, totalLabel, lineLabel, className }: BloqueProps) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink">{titulo}</span>
        <span className="text-[0.65rem] uppercase tracking-wide text-charcoal-soft/70">{nota}</span>
      </div>
      <ul className="space-y-1.5">
        {lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-4">
            <span className="text-charcoal-soft">
              {lineLabel(l.concepto)}
              {l.detalle && <span className="ml-1 text-xs text-charcoal-soft/60">({l.detalle})</span>}
            </span>
            <span className="tabular-nums text-charcoal">{formatMXNCents(l.monto)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 space-y-1 border-t border-cream-200 pt-2">
        <div className="flex justify-between text-charcoal-soft">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatMXNCents(subtotal)}</span>
        </div>
        <div className="flex justify-between text-charcoal-soft">
          <span>IVA</span>
          <span className="tabular-nums">{formatMXNCents(iva)}</span>
        </div>
        <div className="flex justify-between pt-0.5 font-semibold text-ink">
          <span>{totalLabel}</span>
          <span className="tabular-nums">{formatMXN(total)}</span>
        </div>
      </div>
    </div>
  );
}

/** Desglose de solo lectura para cotizaciones antiguas (sin `grupo`). */
function Plano({ breakdown, lineLabel }: { breakdown: QuoteBreakdown; lineLabel: (c: string) => string }) {
  return (
    <div className="text-sm">
      <ul className="space-y-2">
        {breakdown.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-4">
            <span className="text-charcoal-soft">
              {lineLabel(l.concepto)}
              {l.detalle && <span className="ml-1 text-xs text-charcoal-soft/60">({l.detalle})</span>}
            </span>
            <span className="tabular-nums text-charcoal">{formatMXNCents(l.monto)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-1 border-t border-cream-300 pt-4">
        <div className="flex justify-between text-charcoal-soft">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatMXNCents(breakdown.subtotal)}</span>
        </div>
        <div className="flex justify-between text-charcoal-soft">
          <span>IVA</span>
          <span className="tabular-nums">{formatMXNCents(breakdown.iva)}</span>
        </div>
        <div className="flex justify-between pt-1 font-display text-xl text-ink">
          <span>Total</span>
          <span className="tabular-nums">{formatMXN(breakdown.total)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Desglose en dos bloques independientes: lo que cobra la Hacienda (renta) y lo
 * que se paga al proveedor (alimentos + servicios). Cada bloque trae su propio
 * subtotal + IVA + total para que quede claro qué medimos (la renta) y qué no.
 */
export function BreakdownGrouped({ breakdown, lineLabel = (c) => c }: Props) {
  // Cotizaciones antiguas (desglose congelado antes de este cambio) no traen `grupo`.
  const tieneGrupos = breakdown.lines.some((l) => l.grupo);
  if (!tieneGrupos) return <Plano breakdown={breakdown} lineLabel={lineLabel} />;

  const renta = breakdown.lines.filter((l) => l.grupo === 'renta');
  const otros = breakdown.lines.filter((l) => l.grupo === 'otros');

  return (
    <div className="space-y-5 text-sm">
      <Bloque
        titulo="Renta · Hacienda San Andrés"
        nota="La cobra la Hacienda"
        lines={renta}
        subtotal={breakdown.rentaSubtotal}
        iva={breakdown.rentaIva}
        total={breakdown.rentaTotal}
        totalLabel="Total a pagar de salón"
        lineLabel={lineLabel}
      />
      {otros.length > 0 && (
        <Bloque
          titulo="Alimentos y otros servicios"
          nota="Se paga directo al proveedor"
          lines={otros}
          subtotal={breakdown.otrosSubtotal}
          iva={breakdown.otrosIva}
          total={breakdown.otrosTotal}
          totalLabel="Total a pagar al proveedor"
          lineLabel={lineLabel}
        />
      )}
    </div>
  );
}
