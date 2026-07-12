import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  Wallet,
  TrendingUp,
  FileText,
  AlertTriangle,
  Clock,
  ArrowUpRight,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Card, ArrowDivider } from '../components/ui.tsx';
import { STATUS_LABEL, STATUS_STYLE } from '../lib/status.ts';
import { useAuth } from '../auth/auth.tsx';
import type { DashboardData } from '../lib/types.ts';

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

/** Días restantes (o vencido) contra una fecha ISO, en texto humano. */
function vence(iso: string, vencido: boolean): string {
  const dias = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (vencido) return `Vencido hace ${Math.abs(dias)} d`;
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  return `Faltan ${dias} d`;
}

function KpiCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card className={`p-5 ${accent ? 'bg-gold/[0.06]' : ''}`}>
      <div className="flex items-center gap-2 text-charcoal-soft">
        <span className={accent ? 'text-gold' : 'text-ink-300'}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-[0.08em]">{label}</span>
      </div>
      <p className={`mt-3 font-display text-4xl ${accent ? 'text-gold' : 'text-ink'}`}>{value}</p>
    </Card>
  );
}

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
      <div className="mb-8">
        <ArrowDivider>Panel</ArrowDivider>
        <h1 className="mt-2 font-display text-4xl text-ink">
          {saludo()}, {user?.nombre?.split(' ')[0] ?? ''}
        </h1>
        <p className="mt-1 text-sm text-charcoal-soft">{hoyLargo()}</p>
      </div>

      {isLoading && <p className="text-charcoal-soft">Cargando panel…</p>}

      {data && (
        <>
          <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<CalendarDays size={16} />}
              label="Eventos del mes"
              value={String(data.kpis.eventosMes)}
            />
            <KpiCard
              icon={<Wallet size={16} />}
              label="Por cobrar"
              value={formatMXN(data.kpis.porCobrar)}
              accent
            />
            <KpiCard
              icon={<TrendingUp size={16} />}
              label="Cobrado este mes"
              value={formatMXN(data.kpis.cobradoMes)}
            />
            <KpiCard
              icon={<FileText size={16} />}
              label="Cotizaciones activas"
              value={String(data.kpis.cotizacionesActivas)}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            {/* Próximos cobros — la columna ancha, es lo accionable */}
            <section className="lg:col-span-3">
              <h2 className="mb-3 flex items-center gap-2 font-display text-2xl text-ink">
                <Clock size={18} className="text-gold" /> Próximos cobros
              </h2>
              <Card className="divide-y divide-cream-200">
                {data.vencimientos.length === 0 ? (
                  <p className="p-6 text-sm text-charcoal-soft">Sin cobros pendientes con fecha próxima.</p>
                ) : (
                  data.vencimientos.map((v) => (
                    <button
                      key={v.quoteId + v.hito}
                      onClick={() => abrir(v.quoteId)}
                      className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-cream-100/60"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{v.cliente}</p>
                        <p className="text-xs text-charcoal-soft">
                          {v.hito} · {v.evento}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <div className="text-right">
                          <p className="font-display text-lg text-ink">{formatMXN(v.restante)}</p>
                          <p
                            className={`text-xs font-medium ${
                              v.vencido ? 'text-wine' : 'text-charcoal-soft'
                            }`}
                          >
                            {vence(v.venceISO, v.vencido)}
                          </p>
                        </div>
                        <ArrowUpRight size={16} className="text-ink-300" />
                      </div>
                    </button>
                  ))
                )}
              </Card>
            </section>

            <div className="space-y-6 lg:col-span-2">
              {/* Alertas de desfase — auditoría */}
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-display text-2xl text-ink">
                  <AlertTriangle size={18} className="text-wine" /> Alertas
                </h2>
                <Card className="divide-y divide-cream-200">
                  {data.desfases.length === 0 ? (
                    <p className="p-6 text-sm text-charcoal-soft">Todo en orden. Sin desfases de pago.</p>
                  ) : (
                    data.desfases.map((d) => (
                      <button
                        key={d.quoteId}
                        onClick={() => abrir(d.quoteId)}
                        className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-wine/[0.04]"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{d.cliente}</p>
                          <p className="text-xs text-charcoal-soft">
                            {STATUS_LABEL[d.status]} · saldo {formatMXN(d.saldo)}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-wine/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-wine">
                          Desfase
                        </span>
                      </button>
                    ))
                  )}
                </Card>
              </section>

              {/* Próximos eventos */}
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-display text-2xl text-ink">
                  <CalendarDays size={18} className="text-gold" /> Próximos eventos
                </h2>
                <Card className="divide-y divide-cream-200">
                  {data.proximosEventos.length === 0 ? (
                    <p className="p-6 text-sm text-charcoal-soft">Sin eventos próximos en la agenda.</p>
                  ) : (
                    data.proximosEventos.map((e) => (
                      <button
                        key={e.quoteId}
                        onClick={() => abrir(e.quoteId)}
                        className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-cream-100/60"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{e.cliente}</p>
                          <p className="text-xs text-charcoal-soft">
                            {formatEventDate(e.fechaEventoISO)} · {e.evento}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${STATUS_STYLE[e.status]}`}
                        >
                          {STATUS_LABEL[e.status]}
                        </span>
                      </button>
                    ))
                  )}
                </Card>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
