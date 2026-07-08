import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ExternalLink, CalendarDays, Users } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { Button, Card, ArrowDivider } from '../components/ui.tsx';
import type { Quote } from '../lib/types.ts';

const statusStyle: Record<string, string> = {
  borrador: 'bg-cream-200 text-charcoal-soft',
  enviada: 'bg-ink/10 text-ink',
  aceptada: 'bg-gold/15 text-gold',
  apartada: 'bg-gold text-cream',
  liquidada: 'bg-ink text-cream',
  vencida: 'bg-wine/10 text-wine',
};

export function QuotesListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => api.get<{ quotes: Quote[] }>('/api/quotes'),
  });

  const quotes = data?.quotes ?? [];

  return (
    <div>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <ArrowDivider>Ventas</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">Cotizaciones</h1>
        </div>
        <Link to="/cotizaciones/nueva">
          <Button variant="gold">
            <Plus size={16} /> Nueva cotización
          </Button>
        </Link>
      </div>

      {isLoading && <p className="text-charcoal-soft">Cargando cotizaciones…</p>}

      {!isLoading && quotes.length === 0 && (
        <Card className="p-12 text-center">
          <p className="font-display text-2xl text-ink">Aún no hay cotizaciones</p>
          <p className="mt-2 text-sm text-charcoal-soft">
            Crea la primera para tu cliente en un par de minutos.
          </p>
          <Link to="/cotizaciones/nueva" className="mt-6 inline-block">
            <Button variant="gold">
              <Plus size={16} /> Nueva cotización
            </Button>
          </Link>
        </Card>
      )}

      <div className="grid gap-3">
        {quotes.map((q) => (
          <Card key={q.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-[12rem]">
              <p className="font-display text-xl text-ink">{q.client?.nombre ?? 'Cliente'}</p>
              <p className="text-xs uppercase tracking-wide text-gold">
                {q.eventType?.nombre ?? 'Evento'}
              </p>
            </div>
            <div className="flex items-center gap-6 text-sm text-charcoal-soft">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={15} className="text-ink-300" />
                {new Date(q.fechaEvento).toLocaleDateString('es-MX', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users size={15} className="text-ink-300" />
                {q.invitados}
              </span>
            </div>
            <div className="text-right">
              <p className="font-display text-2xl text-ink">{formatMXN(q.total)}</p>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${
                  statusStyle[q.status] ?? statusStyle.borrador
                }`}
              >
                {q.status}
              </span>
            </div>
            <a
              href={`/c/${q.publicToken}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-ink/40 hover:bg-ink/5"
            >
              <ExternalLink size={14} /> Link cliente
            </a>
          </Card>
        ))}
      </div>
    </div>
  );
}
