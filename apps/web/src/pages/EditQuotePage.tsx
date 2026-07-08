import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Printer } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN, formatMXNCents } from '../lib/money.ts';
import { Button, Card, SelectInput, ArrowDivider } from '../components/ui.tsx';
import { QuoteForm, type QuotePayload, type QuoteFormInitial } from '../components/QuoteForm.tsx';
import { STATUS_LABEL, STATUS_STYLE, EDITABLE_STATUSES } from '../lib/status.ts';
import { QUOTE_STATUSES, type Catalog, type Quote, type QuoteStatus } from '../lib/types.ts';

function toInitial(q: Quote): Partial<QuoteFormInitial> {
  return {
    nombre: q.client?.nombre ?? '',
    telefono: q.client?.telefono ?? '',
    correo: q.client?.correo ?? '',
    eventTypeId: q.eventTypeId,
    fecha: q.fechaEvento.slice(0, 10),
    invitados: q.invitados,
    spaceIds: q.spaceIds,
    foodPackageId: q.foodPackageId ?? '',
    horasExtra: q.horasExtra,
    addOns: Object.fromEntries((q.addOns ?? []).map((a) => [a.addOnId, a.cantidad])),
  };
}

export function EditQuotePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const quoteQ = useQuery({
    queryKey: ['quote', id],
    queryFn: () => api.get<{ quote: Quote }>(`/api/quotes/${id}`),
  });
  const catalogQ = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Catalog>('/api/catalog') });

  const quote = quoteQ.data?.quote;
  const catalog = catalogQ.data;

  async function changeStatus(status: QuoteStatus) {
    if (!quote) return;
    await api.patch(`/api/quotes/${quote.id}/status`, { status });
    await qc.invalidateQueries({ queryKey: ['quote', id] });
    await qc.invalidateQueries({ queryKey: ['quotes'] });
  }

  async function handleSave(payload: QuotePayload) {
    if (!quote) return;
    setError('');
    setSaved(false);
    try {
      await api.put(`/api/quotes/${quote.id}`, payload);
      await qc.invalidateQueries({ queryKey: ['quote', id] });
      await qc.invalidateQueries({ queryKey: ['quotes'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('No se pudo guardar. Revisa los datos o el estatus.');
    }
  }

  if (quoteQ.isLoading || catalogQ.isLoading) return <p className="text-charcoal-soft">Cargando…</p>;
  if (!quote || !catalog) return <p className="text-wine">No se encontró la cotización.</p>;

  const editable = EDITABLE_STATUSES.includes(quote.status);
  const publicUrl = `${window.location.origin}/c/${quote.publicToken}`;

  return (
    <div>
      <Link
        to="/cotizaciones"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal-soft hover:text-ink"
      >
        <ArrowLeft size={15} /> Cotizaciones
      </Link>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>{quote.eventType?.nombre ?? 'Evento'}</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">{quote.client?.nombre}</h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            {new Date(quote.fechaEvento).toLocaleDateString('es-MX', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}{' '}
            · {quote.invitados} invitados · {formatMXN(quote.total)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-charcoal-soft">Estatus</span>
            <SelectInput
              value={quote.status}
              onChange={(e) => void changeStatus(e.target.value as QuoteStatus)}
              className="w-auto py-2"
            >
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </SelectInput>
          </label>
          <a href={publicUrl} target="_blank" rel="noreferrer">
            <Button variant="outline">
              <ExternalLink size={15} /> Ver / Imprimir
            </Button>
          </a>
        </div>
      </div>

      {editable ? (
        <>
          {saved && (
            <p className="mb-4 rounded-lg bg-gold/15 px-4 py-2 text-sm text-gold">
              Cambios guardados. El desglose se recalculó.
            </p>
          )}
          <QuoteForm
            catalog={catalog}
            initial={toInitial(quote)}
            submitLabel="Guardar cambios"
            onSubmit={handleSave}
            errorMsg={error}
          />
        </>
      ) : (
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${STATUS_STYLE[quote.status]}`}
            >
              {STATUS_LABEL[quote.status]}
            </span>
            <p className="text-sm text-charcoal-soft">
              Ya no es editable (tiene compromiso de pago). Puedes cambiar el estatus o imprimir.
            </p>
          </div>
          <ul className="divide-y divide-cream-200">
            {quote.breakdown.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-4 py-2.5 text-sm">
                <span className="text-charcoal-soft">
                  {l.concepto}
                  {l.detalle && <span className="ml-1 text-xs text-charcoal-soft/60">({l.detalle})</span>}
                </span>
                <span className="tabular-nums text-charcoal">{formatMXNCents(l.monto)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-between border-t border-cream-300 pt-4 font-display text-xl text-ink">
            <span>Total</span>
            <span className="tabular-nums">{formatMXN(quote.total)}</span>
          </div>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-6 inline-block">
            <Button variant="gold">
              <Printer size={15} /> Ver / Imprimir PDF
            </Button>
          </a>
        </Card>
      )}
    </div>
  );
}
