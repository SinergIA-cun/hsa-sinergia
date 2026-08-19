import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookMarked,
  Hash,
  ExternalLink,
  Printer,
  FileText,
  MessageCircle,
  QrCode,
  Check,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { BreakdownGrouped } from '../components/BreakdownGrouped.tsx';
import { whatsappUrl, mensajeCotizacion } from '../lib/share.ts';
import { Button, Card, SelectInput, ArrowDivider } from '../components/ui.tsx';
import { QuoteForm, type QuotePayload, type QuoteFormInitial } from '../components/QuoteForm.tsx';
import { PagosPanel } from '../components/PagosPanel.tsx';
import { CompartirClienteModal } from '../components/CompartirClienteModal.tsx';
import { ConfirmarEmpalmeModal, type EspacioOcupado } from '../components/ConfirmarEmpalmeModal.tsx';
import { MoverCatalogoModal } from '../components/MoverCatalogoModal.tsx';
import { OperativaSection } from '../components/OperativaSection.tsx';
import { DESPLAZADAS_KEY } from '../lib/desplazadas.ts';
import { STATUS_LABEL, STATUS_STYLE, EDITABLE_STATUSES } from '../lib/status.ts';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import {
  QUOTE_STATUSES,
  type Availability,
  type Catalog,
  type Quote,
  type QuoteDetail,
  type QuoteStatus,
} from '../lib/types.ts';
import { useAuth } from '../auth/auth.tsx';

/**
 * Estatus que apartan la fecha de verdad. Debe seguir a `BLOQUEO` del servidor
 * (`apps/api/src/availability/service.ts`) y a `BLOQUEANTES` de `empalmes.ts`.
 */
const ESTATUS_QUE_APARTAN: QuoteStatus[] = ['formalizada', 'complementada', 'liquidada'];
const APARTAN = new Set<string>(ESTATUS_QUE_APARTAN);

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
    capillaHorario: q.capillaHorario ?? '',
    esCortesia: q.esCortesia ?? false,
    usaDjHoraExtra: q.usaDjHoraExtra ?? false,
    addOns: Object.fromEntries((q.addOns ?? []).map((a) => [a.addOnId, a.cantidad])),
    // Los extras y el descuento se devuelven al formulario porque guardar manda
    // la lista COMPLETA: si no viajaran de vuelta, reeditar cualquier otra cosa
    // del evento los borraría en silencio y el total bajaría solo.
    extras: q.extras ?? [],
    descuentoPct: q.descuentoPct ?? null,
    descuentoMotivo: q.descuentoMotivo ?? '',
    requiereFactura: q.requiereFactura ?? false,
    // El banquetero y el festejado viajan de vuelta por la misma razón que los
    // extras: guardar manda los tres campos, así que si no regresaran, reeditar
    // cualquier otra cosa del evento los borraría en silencio.
    banqueteroId: q.banqueteroId ?? '',
    banqueteroNombre: q.banquetero?.nombre ?? '',
    festejado: q.festejado ?? '',
    festejadoTelefono: q.festejadoTelefono ?? '',
    fiscales: {
      rfc: q.client?.rfc,
      razonSocial: q.client?.razonSocial,
      regimenFiscal: q.client?.regimenFiscal,
      cpFiscal: q.client?.cpFiscal,
      usoCfdi: q.client?.usoCfdi,
      correoFacturacion: q.client?.correoFacturacion,
    },
  };
}

export function EditQuotePage() {
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const qc = useQueryClient();

  // Origen de la navegación: si vino de la agenda, "atrás" regresa a ese mes.
  const desdeAgenda = sp.get('volver') === 'agenda';
  const backTo = desdeAgenda ? `/agenda?m=${sp.get('m') ?? ''}` : '/cotizaciones';
  const backLabel = desdeAgenda ? 'Agenda' : 'Contratos';
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [compartir, setCompartir] = useState(false);
  const [moverCatalogo, setMoverCatalogo] = useState(false);
  const [empalme, setEmpalme] = useState<{ status: QuoteStatus; ocupados: EspacioOcupado[] } | null>(null);
  const [empalmeBusy, setEmpalmeBusy] = useState(false);
  const [empalmeError, setEmpalmeError] = useState('');
  // Al recién crearlo llegamos con ?creado=1 para confirmar sin sacar del contrato.
  const recienCreado = sp.get('creado') === '1';

  const quoteQ = useQuery({
    queryKey: ['quote', id],
    queryFn: () => api.get<QuoteDetail>(`/api/quotes/${id}`),
  });

  // El catálogo que se pide es EL DE LA COTIZACIÓN, no el activo. Con el activo,
  // una cotización de 2027 abierta cuando ya corre 2028 mostraría precios que no
  // son los suyos, y peor: el paquete y los servicios que trae seleccionados son
  // registros de 2027 que no existen en 2028, así que el formulario los perdería
  // al guardar. Es la misma clase de bug que el plan vino a matar.
  const priceListId = quoteQ.data?.quote.priceListId;
  const catalogQ = useQuery({
    queryKey: ['catalog', priceListId],
    queryFn: () => api.get<Catalog>(`/api/catalog?priceListId=${priceListId!}`),
    enabled: Boolean(priceListId),
  });

  const quote = quoteQ.data?.quote;
  const estadoCuenta = quoteQ.data?.estadoCuenta;
  const payments = quoteQ.data?.payments;
  const activityLog = quoteQ.data?.activityLog;
  const catalog = catalogQ.data;
  const isAdmin = user?.role === 'admin';

  async function aplicarStatus(status: QuoteStatus) {
    if (!quote) return;
    await api.patch(`/api/quotes/${quote.id}/status`, { status });
    await qc.invalidateQueries({ queryKey: ['quote', id] });
    await qc.invalidateQueries({ queryKey: ['quotes'] });
    // Apartar (o soltar) una fecha cambia quién queda desplazado.
    await qc.invalidateQueries({ queryKey: DESPLAZADAS_KEY });
  }

  /**
   * Apartar una fecha ya comprometida AVISA, nunca bloquea: el cambio se manda
   * igual si quien vende lo confirma, porque el pago del cliente siempre se
   * registra. La API tampoco lo rechaza — esto es solo el aviso.
   */
  async function changeStatus(status: QuoteStatus) {
    if (!quote) return;
    const yaApartaba = ESTATUS_QUE_APARTAN.includes(quote.status);
    if (!ESTATUS_QUE_APARTAN.includes(status) || yaApartaba) {
      await aplicarStatus(status);
      return;
    }
    const fecha = quote.fechaEvento.slice(0, 10);
    let disp: Availability;
    try {
      disp = await api.get<Availability>(
        `/api/availability?fecha=${fecha}&spaceIds=${quote.spaceIds.join(',')}&excludeQuoteId=${quote.id}`,
      );
    } catch {
      // Sin disponibilidad no se puede avisar, pero tampoco se puede frenar la
      // operación: se aparta igual. Peor sería dejar el pago sin registrar.
      await aplicarStatus(status);
      return;
    }
    const ocupados = disp.spaces
      .filter((s) => s.level === 'bloqueada')
      .map((s) => ({
        nombre: s.nombre,
        clientes: [...new Set(s.quotes.filter((q) => APARTAN.has(q.status)).map((q) => q.cliente))],
      }));
    if (ocupados.length === 0) {
      await aplicarStatus(status);
      return;
    }
    setEmpalme({ status, ocupados });
  }

  async function confirmarEmpalme() {
    if (!empalme) return;
    setEmpalmeBusy(true);
    setEmpalmeError('');
    try {
      await aplicarStatus(empalme.status);
      setEmpalme(null);
    } catch {
      setEmpalmeError('No se pudo cambiar el estatus. Intenta de nuevo.');
    } finally {
      setEmpalmeBusy(false);
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

  if (quoteQ.isLoading) return <p className="text-charcoal-soft">Cargando…</p>;
  if (!quote || !estadoCuenta || !payments || !activityLog) {
    return <p className="text-wine">No se encontró el contrato.</p>;
  }
  // El catálogo arranca deshabilitado hasta saber cuál pide la cotización, así
  // que se espera por `isPending`: con `isLoading` habría un parpadeo de "no se
  // encontró el contrato" entre que llega la cotización y arranca el catálogo.
  if (catalogQ.isPending) return <p className="text-charcoal-soft">Cargando…</p>;
  if (!catalog) return <p className="text-wine">No se pudo cargar el catálogo de la cotización.</p>;

  const enPapelera = Boolean(quote.deletedAt);
  const editable = EDITABLE_STATUSES.includes(quote.status) && !enPapelera;
  const contratoDisponible =
    !enPapelera && ['formalizada', 'complementada', 'liquidada'].includes(quote.status);
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

      {recienCreado && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-600/10 px-4 py-2.5 text-sm text-emerald-800">
          <Check size={16} className="shrink-0" />
          Contrato creado. Comparte el QR o el enlace con el cliente y registra sus pagos aquí abajo.
        </div>
      )}

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>{quote.eventType?.nombre ?? 'Evento'}</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">{quote.client?.nombre}</h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            {formatEventDate(quote.fechaEvento, 'long')} · {quote.invitados} invitados ·{' '}
            {formatMXN(quote.total)}
          </p>
          {/* A qué catálogo pertenece: es el dato que explica por qué dos
              cotizaciones de fechas parecidas tienen precios distintos. */}
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-charcoal-soft">
            {/* El código de evento: la identidad del evento, la que se copia al
                recibo, al contrato y a los correos. Se congela al formalizar. */}
            {quote.codigo && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-0.5 font-mono text-[0.7rem] font-semibold tracking-tight text-cream">
                <Hash size={12} /> {quote.codigo}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cream-200 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-ink-500">
              <BookMarked size={12} /> Catálogo {quote.priceList?.nombre ?? '—'}
            </span>
            <span>Sus precios mandan aunque el catálogo activo sea otro.</span>
            {isAdmin && !enPapelera && (
              <button
                type="button"
                className="rounded text-xs font-medium text-gold underline underline-offset-2 hover:text-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
                onClick={() => setMoverCatalogo(true)}
              >
                Mover de catálogo
              </button>
            )}
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
            <Button variant="gold" onClick={() => setCompartir(true)}>
              <QrCode size={15} /> QR / enlace cliente
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
            fiscalEditable={quoteQ.data?.fiscalEditable}
            isAdmin={isAdmin}
          />
          <PagosPanel
            quoteId={quote.id}
            publicToken={quote.publicToken}
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
                ? 'Solo lectura: contrato eliminado, conservado como evidencia.'
                : 'Ya no es editable (tiene compromiso de pago). Puedes cambiar el estatus o imprimir.'}
            </p>
          </div>
          <BreakdownGrouped breakdown={quote.breakdown} />
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
          publicToken={quote.publicToken}
          isAdmin={isAdmin}
          estadoCuenta={estadoCuenta}
          payments={payments}
          activityLog={activityLog}
          readOnly={enPapelera}
        />
      )}

      {contratoDisponible && <OperativaSection quote={quote} />}

      {compartir && (
        <CompartirClienteModal quote={quote} publicUrl={publicUrl} onClose={() => setCompartir(false)} />
      )}

      {moverCatalogo && (
        <MoverCatalogoModal
          quoteId={quote.id}
          catalogoActual={quote.priceList ?? null}
          totalActual={quote.total}
          pagado={estadoCuenta.pagado}
          onClose={() => setMoverCatalogo(false)}
          onMoved={async () => {
            // Mover represia: cambian el total, el desglose Y el catálogo con el
            // que se pinta el formulario. Sin invalidar los tres, la pantalla
            // sigue mostrando los precios viejos como si nada hubiera pasado.
            await Promise.all([
              qc.invalidateQueries({ queryKey: ['quote', id] }),
              qc.invalidateQueries({ queryKey: ['quotes'] }),
              qc.invalidateQueries({ queryKey: ['catalog'] }),
            ]);
          }}
        />
      )}

      {empalme && (
        <ConfirmarEmpalmeModal
          fecha={quote.fechaEvento.slice(0, 10)}
          estatusLabel={STATUS_LABEL[empalme.status]}
          ocupados={empalme.ocupados}
          busy={empalmeBusy}
          error={empalmeError}
          onCancel={() => {
            setEmpalme(null);
            setEmpalmeError('');
          }}
          onConfirm={() => void confirmarEmpalme()}
        />
      )}
    </div>
  );
}
