import { useState } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Printer, FileText, MessageCircle, Copy } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN, formatMXNCents } from '../lib/money.ts';
import { whatsappUrl, mensajeCotizacion } from '../lib/share.ts';
import { Button, Card, SelectInput, ArrowDivider } from '../components/ui.tsx';
import { QuoteForm, type QuotePayload, type QuoteFormInitial } from '../components/QuoteForm.tsx';
import { PagosPanel } from '../components/PagosPanel.tsx';
import { OperativaSection } from '../components/OperativaSection.tsx';
import { STATUS_LABEL, STATUS_STYLE, EDITABLE_STATUSES } from '../lib/status.ts';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import { QUOTE_STATUSES, type Catalog, type Quote, type QuoteDetail, type QuoteStatus } from '../lib/types.ts';
import { useAuth } from '../auth/auth.tsx';

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
    usaCapilla: q.usaCapilla ?? false,
    esCortesia: q.esCortesia ?? false,
    addOns: Object.fromEntries((q.addOns ?? []).map((a) => [a.addOnId, a.cantidad])),
  };
}

export function EditQuotePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const qc = useQueryClient();

  // Origen de la navegación: si vino de la agenda, "atrás" regresa a ese mes.
  const desdeAgenda = sp.get('volver') === 'agenda';
  const backTo = desdeAgenda ? `/agenda?m=${sp.get('m') ?? ''}` : '/cotizaciones';
  const backLabel = desdeAgenda ? 'Agenda' : 'Cotizaciones';
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [duplicando, setDuplicando] = useState(false);

  const quoteQ = useQuery({
    queryKey: ['quote', id],
    queryFn: () => api.get<QuoteDetail>(`/api/quotes/${id}`),
  });
  const catalogQ = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Catalog>('/api/catalog') });

  const quote = quoteQ.data?.quote;
  const estadoCuenta = quoteQ.data?.estadoCuenta;
  const payments = quoteQ.data?.payments;
  const activityLog = quoteQ.data?.activityLog;
  const catalog = catalogQ.data;
  const isAdmin = user?.role === 'admin';

  async function changeStatus(status: QuoteStatus) {
    if (!quote) return;
    await api.patch(`/api/quotes/${quote.id}/status`, { status });
    await qc.invalidateQueries({ queryKey: ['quote', id] });
    await qc.invalidateQueries({ queryKey: ['quotes'] });
  }

  async function handleDuplicate() {
    if (!quote) return;
    setDuplicando(true);
    setError('');
    try {
      const res = await api.post<{ quote: Quote }>(`/api/quotes/${quote.id}/duplicate`);
      await qc.invalidateQueries({ queryKey: ['quotes'] });
      navigate(`/cotizaciones/${res.quote.id}`);
    } catch {
      setError('No se pudo duplicar la cotización.');
      setDuplicando(false);
    }
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
  if (!quote || !catalog || !estadoCuenta || !payments || !activityLog) {
    return <p className="text-wine">No se encontró la cotización.</p>;
  }

  const enPapelera = Boolean(quote.deletedAt);
  const editable = EDITABLE_STATUSES.includes(quote.status) && !enPapelera;
  const contratoDisponible =
    !enPapelera && ['apartada', 'formalizada', 'liquidada'].includes(quote.status);
  const publicUrl = `${window.location.origin}/c/${quote.publicToken}`;
  const waUrl =
    !enPapelera
      ? whatsappUrl(
          quote.client?.telefono,
          mensajeCotizacion(quote.client?.nombre ?? 'cliente', quote.eventType?.nombre ?? 'evento', publicUrl),
        )
      : null;

  return (
    <div>
      <Link
        to={backTo}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal-soft hover:text-ink"
      >
        <ArrowLeft size={15} /> {backLabel}
      </Link>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>{quote.eventType?.nombre ?? 'Evento'}</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">{quote.client?.nombre}</h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            {formatEventDate(quote.fechaEvento, 'long')} · {quote.invitados} invitados ·{' '}
            {formatMXN(quote.total)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!enPapelera && (
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
          )}
          {!enPapelera && (
            <a href={publicUrl} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <ExternalLink size={15} /> Ver / Imprimir
              </Button>
            </a>
          )}
          {!enPapelera && (
            <Button variant="outline" onClick={() => void handleDuplicate()} disabled={duplicando}>
              <Copy size={15} /> {duplicando ? 'Duplicando…' : 'Duplicar'}
            </Button>
          )}
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-medium tracking-wide text-white shadow-sm transition-colors hover:bg-[#1da851]"
            >
              <MessageCircle size={15} /> WhatsApp
            </a>
          )}
          {contratoDisponible && (
            <Link to={`/cotizaciones/${quote.id}/contrato`}>
              <Button variant="gold">
                <FileText size={15} /> Generar contrato
              </Button>
            </Link>
          )}
        </div>
      </div>

      {enPapelera && (
        <div className="mb-6 rounded-lg border border-wine/30 bg-wine/5 px-4 py-3 text-sm text-wine">
          <strong>En papelera</strong> desde el {formatTimestamp(quote.deletedAt!)} · vista de solo
          lectura para auditoría. Revisa la bitácora para ver quién la eliminó; restáurala desde la
          Papelera si fue un error.
        </div>
      )}

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
            excludeQuoteId={quote.id}
          />
          <PagosPanel
            quoteId={quote.id}
            isAdmin={isAdmin}
            estadoCuenta={estadoCuenta}
            payments={payments}
            activityLog={activityLog}
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
              {enPapelera
                ? 'Solo lectura: cotización eliminada, conservada como evidencia.'
                : 'Ya no es editable (tiene compromiso de pago). Puedes cambiar el estatus o imprimir.'}
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
          {!enPapelera && (
            <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-6 inline-block">
              <Button variant="gold">
                <Printer size={15} /> Ver / Imprimir PDF
              </Button>
            </a>
          )}
        </Card>
      )}

      {!editable && (
        <PagosPanel
          quoteId={quote.id}
          isAdmin={isAdmin}
          estadoCuenta={estadoCuenta}
          payments={payments}
          activityLog={activityLog}
          readOnly={enPapelera}
        />
      )}

      {contratoDisponible && <OperativaSection quote={quote} />}
    </div>
  );
}
