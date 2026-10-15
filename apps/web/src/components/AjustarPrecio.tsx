import { tieneCentavosValidos, sumarDinero } from '@hsa/shared';
import { useState } from 'react';
import type { QuoteBreakdown, QuoteLine } from '@hsa/shared';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { Button, Field, MoneyInput, TextInput } from './ui.tsx';
import { apiErrorMessage } from './admin/shared.tsx';

// Ajustar el precio de un evento con precio pactado (importado del BI o apartado
// con renta acordada). El formulario normal no se abre para ellos porque
// recotizaría con el catálogo; aquí un admin pone los montos que de verdad se
// pactaron, con motivo, y queda en la bitácora (13-oct-2026).

const esRentaSalon = (l: QuoteLine) => l.grupo === 'renta' && !l.cargoId && (Boolean(l.spaceId) || l.ref?.tipo === 'rentaSalon');
const esOtrosPactado = (l: QuoteLine) => l.grupo === 'otros' && !l.cargoId && l.ref?.tipo === 'pactado';
const suma = (ls: QuoteLine[]) => ls.reduce((s, l) => sumarDinero(s, l.monto), 0);

export function AjustarPrecioForm({
  quoteId,
  breakdown,
  total,
  pagado,
  onListo,
  onCancelar,
}: {
  quoteId: string;
  breakdown: QuoteBreakdown;
  total: number;
  pagado: number;
  onListo: () => Promise<void> | void;
  onCancelar: () => void;
}) {
  const rentaSalon = suma(breakdown.lines.filter(esRentaSalon));
  // Lo demás de la renta (horas extra y PAX del punto de venta, capilla…) no se toca aquí.
  const otraRenta = Math.round(breakdown.rentaTotal) - rentaSalon;
  // Los alimentos solo se ajustan si son pactados (eventos del BI); los del catálogo, no.
  const otrosEditables = !breakdown.lines.some((l) => l.grupo === 'otros' && !l.cargoId && !esOtrosPactado(l));
  const otrosActual = Math.round(breakdown.otrosTotal ?? 0);

  const [renta, setRenta] = useState(String(rentaSalon));
  const [otros, setOtros] = useState(String(otrosActual));
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const nRenta = Number(renta || 0);
  const nOtros = otrosEditables ? Number(otros || 0) : otrosActual;
  const nuevoTotal = nRenta + otraRenta + nOtros;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!tieneCentavosValidos(nRenta) || nRenta < 0) return setError('La renta admite a lo más dos decimales.');
    if (nRenta + otraRenta < pagado) return setError(`Ya hay ${formatMXN(pagado)} pagados: la renta no puede quedar por debajo.`);
    if (nuevoTotal === total) return setError('El total es el mismo: no hay nada que ajustar.');
    if (motivo.trim().length < 3) return setError('Escribe el motivo del ajuste.');
    setError('');
    setEnviando(true);
    try {
      await api.patch(`/api/quotes/${quoteId}/precio-pactado`, {
        renta: nRenta,
        ...(otrosEditables ? { otros: nOtros } : {}),
        motivo: motivo.trim(),
      });
      await onListo();
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo ajustar el precio.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="mt-4 grid gap-3 rounded-lg border border-gold/40 bg-gold/5 p-4 sm:grid-cols-2">
      <p className="text-sm font-medium text-ink sm:col-span-2">Ajustar el precio pactado</p>
      <Field label="Renta del salón (con IVA)" hint={otraRenta ? `Más ${formatMXN(otraRenta)} de horas extra, PAX u otros de la renta, que no cambian.` : undefined}>
        <MoneyInput value={renta} onValue={setRenta} />
      </Field>
      {otrosEditables && (
        <Field label="Alimentos y servicios (con IVA)" hint="Lo pactado aparte de la renta. En cero, se quita.">
          <MoneyInput value={otros} onValue={setOtros} />
        </Field>
      )}
      <p className="text-sm text-charcoal-soft sm:col-span-2">
        Total del evento: {formatMXN(total)} → <strong className="text-ink">{formatMXN(nuevoTotal)}</strong>
      </p>
      <div className="sm:col-span-2">
        <Field label="Motivo" hint="Queda en la bitácora del evento con tu usuario.">
          <TextInput value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ej. subió a 250 invitados" />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm text-wine sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="gold" className="px-3 py-1.5 text-xs" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar ajuste'}
        </Button>
        <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
