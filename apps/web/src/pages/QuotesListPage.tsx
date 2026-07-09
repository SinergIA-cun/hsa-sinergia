import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ExternalLink, CalendarDays, Users, UserCircle } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { Button, Card, ArrowDivider } from '../components/ui.tsx';
import { STATUS_LABEL, STATUS_STYLE } from '../lib/status.ts';
import { useAuth } from '../auth/auth.tsx';
import type { Quote, QuoteStatus } from '../lib/types.ts';

const SECTIONS: { title: string; statuses: QuoteStatus[]; defaultOpen: boolean }[] = [
  { title: 'Cotizaciones', statuses: ['borrador', 'enviada', 'aceptada', 'vencida'], defaultOpen: true },
  { title: 'Eventos Apartados', statuses: ['apartada'], defaultOpen: true },
  { title: 'Eventos Formalizados', statuses: ['formalizada'], defaultOpen: false },
  { title: 'Eventos Liquidados', statuses: ['liquidada'], defaultOpen: false },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function QuoteRow({ q, showSeller }: { q: Quote; showSeller: boolean }) {
  const navigate = useNavigate();
  return (
    <Card
      className="flex cursor-pointer flex-wrap items-center justify-between gap-4 p-5 transition-shadow hover:shadow-md"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
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
            <CalendarDays size={14} className="text-ink-300" /> {fmtDate(q.fechaEvento)}
          </span>
          <span className="mt-0.5 text-[0.7rem] text-charcoal-soft/70">
            creada {fmtDate(q.createdAt)}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} className="text-ink-300" /> {q.invitados}
        </span>
      </div>
      <div className="text-right" onClick={() => navigate(`/cotizaciones/${q.id}`)}>
        <p className="font-display text-2xl text-ink">{formatMXN(q.total)}</p>
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${STATUS_STYLE[q.status]}`}
        >
          {STATUS_LABEL[q.status]}
        </span>
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

export function QuotesListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data, isLoading } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => api.get<{ quotes: Quote[] }>('/api/quotes'),
  });
  const quotes = data?.quotes ?? [];

  // CRM por vendedora (solo admin)
  const perSeller = new Map<string, number>();
  if (isAdmin) {
    for (const q of quotes) {
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
            {isAdmin ? 'Cotizaciones del equipo' : 'Mis cotizaciones'}
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

      {isLoading && <p className="text-charcoal-soft">Cargando…</p>}

      {!isLoading && quotes.length === 0 && (
        <Card className="p-12 text-center">
          <p className="font-display text-2xl text-ink">Aún no hay cotizaciones</p>
          <p className="mt-2 text-sm text-charcoal-soft">Crea la primera en un par de minutos.</p>
          <Link to="/cotizaciones/nueva" className="mt-6 inline-block">
            <Button variant="gold">
              <Plus size={16} /> Nueva cotización
            </Button>
          </Link>
        </Card>
      )}

      {!isLoading &&
        quotes.length > 0 &&
        SECTIONS.map((s) => (
          <Section
            key={s.title}
            title={s.title}
            defaultOpen={s.defaultOpen}
            showSeller={isAdmin}
            quotes={quotes.filter((q) => s.statuses.includes(q.status))}
          />
        ))}
    </div>
  );
}
