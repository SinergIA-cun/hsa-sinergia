import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, MapPin } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Card, ArrowDivider } from '../components/ui.tsx';
import { STATUS_LABEL, STATUS_STYLE } from '../lib/status.ts';
import type { AgendaEvent, Catalog } from '../lib/types.ts';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function AgendaPage() {
  const navigate = useNavigate();
  const from = iso(new Date());
  const to = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 12);
    return iso(d);
  }, []);

  const catalogQ = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Catalog>('/api/catalog') });
  const agendaQ = useQuery({
    queryKey: ['agenda', from, to],
    queryFn: () => api.get<{ events: AgendaEvent[] }>(`/api/agenda?from=${from}&to=${to}`),
  });

  const spaceName = useMemo(() => {
    const m = new Map<string, string>();
    catalogQ.data?.spaces.forEach((s) => m.set(s.id, s.nombre));
    return m;
  }, [catalogQ.data]);

  // Agrupar por fecha (día del evento).
  const byDate = useMemo(() => {
    const groups = new Map<string, AgendaEvent[]>();
    (agendaQ.data?.events ?? []).forEach((e) => {
      const key = e.fechaEvento.slice(0, 10);
      const arr = groups.get(key) ?? [];
      arr.push(e);
      groups.set(key, arr);
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [agendaQ.data]);

  return (
    <div>
      <div className="mb-6">
        <ArrowDivider>Disponibilidad</ArrowDivider>
        <h1 className="mt-2 font-display text-4xl text-ink">Agenda de eventos</h1>
        <p className="mt-1 text-sm text-charcoal-soft">Próximos 12 meses. Un evento por espacio y fecha.</p>
      </div>

      {agendaQ.isLoading && <p className="text-charcoal-soft">Cargando…</p>}

      {!agendaQ.isLoading && byDate.length === 0 && (
        <Card className="p-12 text-center">
          <p className="font-display text-2xl text-ink">Sin eventos próximos</p>
          <p className="mt-2 text-sm text-charcoal-soft">Las cotizaciones aparecerán aquí por fecha.</p>
        </Card>
      )}

      <div className="space-y-6">
        {byDate.map(([date, events]) => (
          <div key={date}>
            <div className="mb-2 flex items-center gap-2 text-ink">
              <CalendarDays size={16} className="text-gold" />
              <span className="font-display text-lg capitalize">
                {new Date(`${date}T00:00:00`).toLocaleDateString('es-MX', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div className="grid gap-2">
              {events.map((e) => (
                <Card
                  key={e.quoteId}
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4 transition-shadow hover:shadow-md"
                  onClick={() => navigate(`/cotizaciones/${e.quoteId}`)}
                >
                  <div>
                    <p className="font-medium text-ink">{e.cliente}</p>
                    <p className="text-xs uppercase tracking-wide text-gold">{e.eventoNombre}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-charcoal-soft">
                    {e.spaceIds.map((sid) => (
                      <span key={sid} className="inline-flex items-center gap-1">
                        <MapPin size={13} className="text-ink-300" /> {spaceName.get(sid) ?? 'Espacio'}
                      </span>
                    ))}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${STATUS_STYLE[e.status]}`}
                  >
                    {STATUS_LABEL[e.status]}
                  </span>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
