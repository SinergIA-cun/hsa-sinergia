import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, AlertTriangle, CalendarClock } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Card, ArrowDivider } from '../components/ui.tsx';
import { STATUS_LABEL, STATUS_STYLE } from '../lib/status.ts';
import { useAuth } from '../auth/auth.tsx';
import type { DashboardData, Semaforo } from '../lib/types.ts';

const saludo = (): string => {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
};

const hoyLargo = (): string => {
  const t = new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const SEMAFORO: Record<Semaforo, { dot: string; label: string; text: string }> = {
  verde: { dot: 'bg-emerald-600', label: 'Lista', text: 'text-emerald-700' },
  amarillo: { dot: 'bg-gold', label: 'Falta algo', text: 'text-gold' },
  rojo: { dot: 'bg-wine', label: 'Atención', text: 'text-wine' },
};

const DIAS = [
  { key: 'viernes', label: 'Viernes' },
  { key: 'sabado', label: 'Sábado' },
  { key: 'domingo', label: 'Domingo' },
] as const;

export function InicioPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/api/dashboard'),
  });

  const abrir = (id: string) => navigate(`/cotizaciones/${id}`);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>Panel · Operación semanal</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">
            {saludo()}, {user?.nombre?.split(' ')[0] ?? ''}
          </h1>
          <p className="mt-1 text-sm text-charcoal-soft">{hoyLargo()}</p>
        </div>
        {data && (
          <Card className="flex items-center gap-3 px-5 py-3">
            <CalendarDays size={18} className="text-gold" />
            <div>
              <p className="font-display text-3xl leading-none text-ink">{data.kpis.eventosMes}</p>
              <p className="text-xs uppercase tracking-[0.08em] text-charcoal-soft">Eventos del mes</p>
            </div>
          </Card>
        )}
      </div>

      {isLoading && <p className="text-charcoal-soft">Cargando panel…</p>}

      {data && (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Fichas operativas de la semana — la columna ancha */}
          <section className="lg:col-span-3">
            <h2 className="mb-1 flex items-center gap-2 font-display text-2xl text-ink">
              <ClipboardList size={18} className="text-gold" /> Fichas de la semana
            </h2>
            <p className="mb-3 text-xs text-charcoal-soft">
              Eventos de esta semana. El semáforo combina la hoja operativa y el finiquito.
            </p>
            <Card className="divide-y divide-cream-200">
              {data.fichasSemana.length === 0 ? (
                <p className="p-6 text-sm text-charcoal-soft">No hay eventos esta semana.</p>
              ) : (
                data.fichasSemana.map((f) => {
                  const s = SEMAFORO[f.semaforo];
                  return (
                    <button
                      key={f.quoteId}
                      onClick={() => abrir(f.quoteId)}
                      className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-cream-100/60"
                    >
                      <span
                        className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${s.dot}`}
                        title={s.label}
                        aria-label={s.label}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <p className="truncate font-medium text-ink">{f.cliente}</p>
                          <span className="text-xs text-charcoal-soft">
                            {formatEventDate(f.fechaEventoISO)}
                          </span>
                        </div>
                        <p className="text-xs text-charcoal-soft">
                          {f.evento} · {f.espacio}
                          {f.finiquitoISO && <> · finiquito {formatEventDate(f.finiquitoISO)}</>}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className={`text-[0.7rem] font-semibold ${s.text}`}>{s.label}</span>
                          {f.faltantes.length > 0 && (
                            <span className="text-[0.7rem] text-charcoal-soft">
                              · falta: {f.faltantes.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </Card>
          </section>

          <div className="space-y-6 lg:col-span-2">
            {/* Alertas: finiquito vencido */}
            <section>
              <h2 className="mb-3 flex items-center gap-2 font-display text-2xl text-ink">
                <AlertTriangle size={18} className="text-wine" /> Alertas
              </h2>
              <Card className="divide-y divide-cream-200">
                {data.alertas.length === 0 ? (
                  <p className="p-6 text-sm text-charcoal-soft">Sin finiquitos vencidos. Todo al día.</p>
                ) : (
                  data.alertas.map((a) => (
                    <button
                      key={a.quoteId}
                      onClick={() => abrir(a.quoteId)}
                      className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-wine/[0.04]"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{a.cliente}</p>
                        <p className="text-xs text-charcoal-soft">
                          {a.evento} · evento {formatEventDate(a.fechaEventoISO)}
                        </p>
                        <p className="text-[0.7rem] font-medium text-wine">
                          Finiquito vencido hace {a.diasVencido} d · restan {formatMXN(a.restante)}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </Card>
            </section>

            {/* Próxima semana: fin de semana por día */}
            <section>
              <h2 className="mb-3 flex items-center gap-2 font-display text-2xl text-ink">
                <CalendarClock size={18} className="text-gold" /> Próxima semana
              </h2>
              <Card className="p-4">
                {data.proximaSemana.length === 0 ? (
                  <p className="p-2 text-sm text-charcoal-soft">Sin eventos el próximo fin de semana.</p>
                ) : (
                  <div className="space-y-3">
                    {DIAS.map(({ key, label }) => {
                      const dia = data.proximaSemana.filter((e) => e.dia === key);
                      if (dia.length === 0) return null;
                      return (
                        <div key={key}>
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-charcoal-soft">
                            {label}
                          </p>
                          <div className="space-y-1.5">
                            {dia.map((e) => (
                              <button
                                key={e.quoteId}
                                onClick={() => abrir(e.quoteId)}
                                className="flex w-full items-center justify-between gap-2 rounded-lg border border-cream-300 bg-white/60 px-3 py-2 text-left text-sm transition-colors hover:border-ink/25"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-ink">{e.cliente}</span>
                                  <span className="block truncate text-xs text-charcoal-soft">{e.espacio}</span>
                                </span>
                                <span
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${STATUS_STYLE[e.status]}`}
                                >
                                  {STATUS_LABEL[e.status]}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
