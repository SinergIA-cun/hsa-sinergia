import type { QuoteBreakdown, QuoteLine } from '@hsa/shared';
import { formatMXN, formatMXNCents } from '../lib/money.ts';

interface Props {
  breakdown: QuoteBreakdown;
  /** Reetiqueta conceptos (p. ej. "Renta arcos" → "Renta Salón Los Arcos"). */
  lineLabel?: (concepto: string) => string;
}

interface GrupoProps {
  titulo: string;
  nota: string;
  lines: QuoteLine[];
  subtotal: number;
  showSubtotal: boolean;
  lineLabel: (concepto: string) => string;
  className?: string;
}

function Grupo({ titulo, nota, lines, subtotal, showSubtotal, lineLabel, className }: GrupoProps) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink">{titulo}</span>
        <span className="text-[0.65rem] uppercase tracking-wide text-charcoal-soft/70">{nota}</span>
      </div>
      <ul className="space-y-2">
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
      {showSubtotal && (
        <div className="mt-2 flex justify-between border-t border-cream-200 pt-2 font-medium text-ink">
          <span>Subtotal {titulo.toLowerCase()}</span>
          <span className="tabular-nums">{formatMXNCents(subtotal)}</span>
        </div>
      )}
    </div>
  );
}

function Totales({ breakdown }: { breakdown: QuoteBreakdown }) {
  return (
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
  );
}

/** Desglose agrupado: Renta (la cobra HSA) y Alimentos + servicios (al proveedor). */
export function BreakdownGrouped({ breakdown, lineLabel = (c) => c }: Props) {
  // Cotizaciones antiguas (desglose congelado antes de este cambio) no traen
  // `grupo`; en ese caso se muestra plano para no ocultar líneas.
  const tieneGrupos = breakdown.lines.some((l) => l.grupo);
  if (!tieneGrupos) {
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
        <Totales breakdown={breakdown} />
      </div>
    );
  }

  const renta = breakdown.lines.filter((l) => l.grupo === 'renta');
  const otros = breakdown.lines.filter((l) => l.grupo === 'otros');
  const haySplit = otros.length > 0;

  return (
    <div className="text-sm">
      <Grupo
        titulo="Renta"
        nota="La cobra la Hacienda"
        lines={renta}
        subtotal={breakdown.rentaTotal}
        showSubtotal={haySplit}
        lineLabel={lineLabel}
      />
      {haySplit && (
        <Grupo
          titulo="Alimentos y servicios"
          nota="Se paga directo al proveedor"
          lines={otros}
          subtotal={breakdown.otrosTotal}
          showSubtotal
          lineLabel={lineLabel}
          className="mt-4"
        />
      )}
      <Totales breakdown={breakdown} />
    </div>
  );
}
