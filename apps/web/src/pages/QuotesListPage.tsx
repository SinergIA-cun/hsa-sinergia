import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ExternalLink, CalendarDays, Users, UserCircle, Trash2, Search, AlertTriangle } from 'lucide-react';
import { faltanDatosFactura } from '@hsa/shared';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { Button, Card, ArrowDivider } from '../components/ui.tsx';
import { STATUS_LABEL, STATUS_STYLE } from '../lib/status.ts';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import { useAuth } from '../auth/auth.tsx';
import type { Quote, QuoteStatus, Catalog } from '../lib/types.ts';

const SECTIONS: { title: string; statuses: QuoteStatus[]; defaultOpen: boolean }[] = [
  { title: 'Contratos', statuses: ['borrador', 'enviada', 'aceptada', 'vencida'], defaultOpen: true },
  { title: 'Eventos Formalizados', statuses: ['formalizada'], defaultOpen: true },
  { title: 'Complemento cubierto', statuses: ['complementada'], defaultOpen: false },
  { title: 'Eventos Liquidados', statuses: ['liquidada'], defaultOpen: false },
];

function QuoteRow({ q, showSeller }: { q: Quote; showSeller: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function eliminar(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm('¿Enviar este contrato a la papelera? Podrás restaurarlo dentro de 30 días.')) return;
    await api.del(`/api/quotes/${q.id}`);
    await qc.invalidateQueries({ queryKey: ['quotes'] });
    // La insignia de la papelera acaba de cambiar: si no se invalida, el número
    // se queda viejo hasta la siguiente recarga completa.
    await qc.invalidateQueries({ queryKey: ['trash-sin-ver'] });
  }

  return (
    <Card
      className="flex cursor-pointer flex-wrap items-center justify-between gap-4 p-5 transition-shadow hover:shadow-md"
    >
      <div className="min-w-[11rem] flex-1" onClick={() => navigate(`/cotizaciones/${q.id}`)}>
        <p className="font-display text-xl text-ink">{q.client?.nombre ?? 'Cliente'}</p>
        <p className="text-xs uppercase tracking-wide text-gold">{q.eventType?.nombre ?? 'Evento'}</p>
        {showSeller && q.createdBy && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-charcoal-soft">
            <UserCircle size={12} /> {q.createdBy.nombre}
          </p>
        )}
      </div>
      <div
        className="flex items-center gap-6 text-sm text-charcoal-soft"
        onClick={() => navigate(`/cotizaciones/${q.id}`)}
      >
        <span className="flex flex-col">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={14} className="text-ink-300" /> {formatEventDate(q.fechaEvento)}
          </span>
          <span className="mt-0.5 text-[0.7rem] text-charcoal-soft/70">
            creada {formatTimestamp(q.createdAt)}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} className="text-ink-300" /> {q.invitados}
        </span>
      </div>
      <div className="text-right" onClick={() => navigate(`/cotizaciones/${q.id}`)}>
        <p className="font-display text-2xl text-ink">{formatMXN(q.total)}</p>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {q.desfase && (
            <span
              title="El pago recibido no cubre lo que exige el estatus actual"
              className="inline-flex items-center gap-1 rounded-full bg-wine/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-wine"
            >
              <AlertTriangle size={11} /> Desfase
            </span>
          )}
          {q.requiereFactura && (() => {
            const incompleto = faltanDatosFactura(q.client ?? {});
            return (
              <span
                className={`rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${
                  incompleto ? 'bg-wine/10 text-wine' : 'bg-emerald-600/10 text-emerald-700'
                }`}
                title={incompleto ? 'Requiere factura y faltan datos fiscales' : 'Requiere factura · datos completos'}
              >
                Factura
              </span>
            );
          })()}
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${STATUS_STYLE[q.status]}`}
          >
            {STATUS_LABEL[q.status]}
          </span>
        </div>
      </div>
      <a
        href={`/c/${q.publicToken}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-ink/40 hover:bg-ink/5"
      >
        <ExternalLink size={14} /> Link
      </a>
      {q.status === 'borrador' && (
        <button
          onClick={eliminar}
          title="Enviar a la papelera"
          className="inline-flex items-center gap-1.5 rounded-lg border border-wine/20 px-3 py-2 text-xs font-medium text-wine transition-colors hover:border-wine/50 hover:bg-wine/5"
        >
          <Trash2 size={14} /> Eliminar
        </button>
      )}
    </Card>
  );
}

function Section({
  title,
  quotes,
  showSeller,
  defaultOpen,
}: {
  title: string;
  quotes: Quote[];
  showSeller: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left"
        aria-expanded={open}
      >
        <span
          className={`text-[0.7rem] leading-none text-gold transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden
        >
          ▶
        </span>
        <span className="font-display text-2xl text-ink">{title}</span>
        <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-semibold text-ink">
          {quotes.length}
        </span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3">
          {quotes.length === 0 ? (
            <p className="px-1 text-sm text-charcoal-soft">Sin registros.</p>
          ) : (
            quotes.map((q) => <QuoteRow key={q.id} q={q} showSeller={showSeller} />)
          )}
        </div>
      )}
    </section>
  );
}

function matchesQuery(q: Quote, needle: string, spaceNameById: Map<string, string>): boolean {
  const espacios = (q.spaceIds ?? []).map((id) => spaceNameById.get(id)).filter(Boolean);
  const hay = [
    q.client?.nombre,
    q.client?.telefono,
    q.client?.correo,
    q.eventType?.nombre,
    q.createdBy?.nombre,
    q.client?.numeroReferencia?.toString(),
    ...espacios,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

export function QuotesListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [query, setQuery] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => api.get<{ quotes: Quote[] }>('/api/quotes'),
  });
  // Mapa espacioId → nombre para poder buscar por espacio (p.ej. "Arcos").
  const { data: catalog } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<Catalog>('/api/catalog'),
  });
  const spaceNameById = new Map((catalog?.spaces ?? []).map((s) => [s.id, s.nombre]));
  const allQuotes = data?.quotes ?? [];
  const needle = query.trim().toLowerCase();
  const quotes = needle ? allQuotes.filter((q) => matchesQuery(q, needle, spaceNameById)) : allQuotes;

  // CRM por ventas (solo admin)
  const perSeller = new Map<string, number>();
  if (isAdmin) {
    for (const q of allQuotes) {
      const name = q.createdBy?.nombre ?? 'Sin asignar';
      perSeller.set(name, (perSeller.get(name) ?? 0) + 1);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <ArrowDivider>{isAdmin ? 'CRM · Ventas' : 'Mis ventas'}</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">
            {isAdmin ? 'Contratos del equipo' : 'Mis contratos'}
          </h1>
        </div>
        <Link to="/cotizaciones/nueva">
          <Button variant="gold">
            <Plus size={16} /> Nueva
          </Button>
        </Link>
      </div>

      {isAdmin && perSeller.size > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          {[...perSeller.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => (
              <span
                key={name}
                className="inline-flex items-center gap-2 rounded-full border border-cream-300 bg-white/70 px-3 py-1.5 text-sm"
              >
                <UserCircle size={15} className="text-gold" />
                <span className="font-medium text-ink">{name}</span>
                <span className="rounded-full bg-ink/10 px-1.5 text-xs font-semibold text-ink">{count}</span>
              </span>
            ))}
        </div>
      )}

      {!isLoading && allQuotes.length > 0 && (
        <div className="relative mb-6 max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente, teléfono, evento, espacio, referencia…"
            className="w-full rounded-lg border border-ink/15 bg-white/70 py-2.5 pl-9 pr-3 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
          />
        </div>
      )}

      {isLoading && <p className="text-charcoal-soft">Cargando…</p>}

      {!isLoading && allQuotes.length === 0 && (
        <Card className="p-12 text-center">
          <p className="font-display text-2xl text-ink">Aún no hay contratos</p>
          <p className="mt-2 text-sm text-charcoal-soft">Crea la primera en un par de minutos.</p>
          <Link to="/cotizaciones/nueva" className="mt-6 inline-block">
            <Button variant="gold">
              <Plus size={16} /> Nuevo contrato
            </Button>
          </Link>
        </Card>
      )}

      {!isLoading && allQuotes.length > 0 && needle && quotes.length === 0 && (
        <p className="text-sm text-charcoal-soft">Sin resultados para “{query}”.</p>
      )}

      {!isLoading &&
        quotes.length > 0 &&
        SECTIONS.map((s) => (
          <Section
            key={s.title + (needle ? '-q' : '')}
            title={s.title}
            defaultOpen={s.defaultOpen || Boolean(needle)}
            showSeller={isAdmin}
            quotes={quotes.filter((q) => s.statuses.includes(q.status))}
          />
        ))}
    </div>
  );
}
