import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, AlertTriangle, CalendarClock, Printer } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Card, ArrowDivider, Button } from '../components/ui.tsx';
import { STATUS_LABEL, STATUS_STYLE } from '../lib/status.ts';
import { AvisoEmpalmes } from '../components/AvisoEmpalmes.tsx';
import { FichaOperativaCard } from '../components/FichaOperativaCard.tsx';
import { FichaOperativaPrint } from '../components/FichaOperativaPrint.tsx';
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

const DIAS = [
  { key: 'viernes', label: 'Viernes' },
  { key: 'sabado', label: 'Sábado' },
  { key: 'domingo', label: 'Domingo' },
] as const;

const DIA_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MES_NOMBRE = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "Sábado 18 de julio" a partir del ISO (en UTC, como se guardan las fechas). */
function diaLargo(iso: string): string {
  const d = new Date(iso);
  return `${DIA_NOMBRE[d.getUTCDay()]} ${d.getUTCDate()} de ${MES_NOMBRE[d.getUTCMonth()]}`;
}

interface FichaSemanaLike {
  quoteId: string;
  fechaEventoISO: string;
}
/** Agrupa las fichas por día (conservando el orden por fecha que ya viene del API). */
function agruparPorDia<T extends FichaSemanaLike>(fichas: T[]): { key: string; label: string; fichas: T[] }[] {
  const grupos: { key: string; label: string; fichas: T[] }[] = [];
  for (const f of fichas) {
    const key = f.fechaEventoISO.slice(0, 10);
    let g = grupos.find((x) => x.key === key);
    if (!g) {
      g = { key, label: diaLargo(f.fechaEventoISO), fichas: [] };
      grupos.push(g);
    }
    g.fichas.push(f);
  }
  return grupos;
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
      <style>{`
        /* La hoja operativa compacta solo existe al imprimir. */
        @media print {
          @page { size: letter portrait; margin: 10mm; }
          .dash-noprint { display: none !important; }

          /* Una hoja por día: viernes, sábado, domingo. */
          .ficha-dia { break-after: page; page-break-after: always; }
          .ficha-dia:last-child { break-after: auto; page-break-after: auto; }
          .ficha-dia-title {
            break-after: avoid; page-break-after: avoid;
            font-size: 13pt; margin: 0 0 4pt;
          }

          /* Ficha compacta: ~3 por hoja. */
          table.fop {
            width: 100%; border-collapse: collapse; table-layout: fixed;
            font-family: system-ui, sans-serif; font-size: 7.4pt;
            margin-bottom: 5pt;
            break-inside: avoid; page-break-inside: avoid;
          }
          table.fop th, table.fop td {
            border: 0.5pt solid #999; padding: 1.6pt 3pt;
            vertical-align: top; line-height: 1.2;
          }
          table.fop th {
            background: #eceae4; text-align: left; font-weight: 700;
            font-size: 6.2pt; letter-spacing: 0.02em; width: 17%;
            text-transform: uppercase; color: #333;
          }
          table.fop td { width: 33%; }
          .fop-strong { font-weight: 700; }
          .fop-pre { white-space: pre-wrap; }
          .fop-alerta { font-weight: 700; }
        }
      `}</style>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <ArrowDivider>Panel · Operación semanal</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">
            {saludo()}, {user?.nombre?.split(' ')[0] ?? ''}
          </h1>
          <p className="mt-1 text-sm text-charcoal-soft">{hoyLargo()}</p>
        </div>
        {data && (
          <div className="flex items-center gap-3 dash-noprint">
            {data.fichasSemana.length > 0 && (
              <Button variant="outline" onClick={() => window.print()}>
                <Printer size={15} /> Imprimir fichas
              </Button>
            )}
            <Card className="flex items-center gap-3 px-5 py-3">
              <CalendarDays size={18} className="text-gold" />
              <div>
                <p className="font-display text-3xl leading-none text-ink">{data.kpis.eventosMes}</p>
                <p className="text-xs uppercase tracking-[0.08em] text-charcoal-soft">Eventos del mes</p>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Empalmes primero: es lo único del panel que exige hablarle hoy a un cliente. */}
      <div className="mb-8 empty:mb-0">
        <AvisoEmpalmes />
      </div>

      {isLoading && <p className="text-charcoal-soft">Cargando panel…</p>}

      {data && (
        <div className="space-y-8">
          {/* Alertas de finiquito — primero y visible */}
          {data.alertas.length > 0 && (
            <section className="dash-noprint">
              <h2 className="mb-3 flex items-center gap-2 font-display text-2xl text-wine">
                <AlertTriangle size={18} /> Alertas de finiquito
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.alertas.map((a) => (
                  <button
                    key={a.quoteId}
                    onClick={() => abrir(a.quoteId)}
                    className="rounded-[var(--radius-card)] border-l-4 border-wine bg-wine/[0.04] p-4 text-left transition-colors hover:bg-wine/[0.08]"
                  >
                    <p className="truncate font-medium text-ink">{a.cliente}</p>
                    <p className="text-xs text-charcoal-soft">
                      {a.evento} · evento {formatEventDate(a.fechaEventoISO)}
                    </p>
                    <p className="mt-1 text-[0.7rem] font-semibold text-wine">
                      Sin finiquitar hace {a.diasVencido} d · restan {formatMXN(a.restante)}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Fichas operativas de la semana */}
          <section className="dash-fichas">
            <div className="mb-3 flex items-end justify-between gap-3 print:hidden">
              <div>
                <h2 className="flex items-center gap-2 font-display text-2xl text-ink">
                  <ClipboardList size={18} className="text-gold" /> Fichas de la semana
                </h2>
                <p className="mt-0.5 text-xs text-charcoal-soft dash-noprint">
                  Una ficha operativa por evento de esta semana. El semáforo combina la hoja operativa y el finiquito.
                </p>
              </div>
            </div>
            {data.fichasSemana.length === 0 ? (
              <Card className="p-6 text-sm text-charcoal-soft">No hay eventos esta semana.</Card>
            ) : (
              <div className="space-y-6">
                {agruparPorDia(data.fichasSemana).map((g) => (
                  <div key={g.key} className="ficha-dia">
                    <h3 className="ficha-dia-title mb-2 border-b border-cream-300 pb-1 font-display text-lg text-ink">
                      {g.label}
                    </h3>
                    {/* Pantalla: tarjetas. */}
                    <div className="ficha-dia-grid grid gap-4 xl:grid-cols-2 print:hidden">
                      {g.fichas.map((f) => (
                        <FichaOperativaCard key={f.quoteId} f={f} onOpen={() => abrir(f.quoteId)} />
                      ))}
                    </div>
                    {/* Impresión: hoja operativa compacta (3 por hoja). */}
                    <div className="hidden print:block">
                      {g.fichas.map((f) => (
                        <FichaOperativaPrint key={f.quoteId} f={f} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Próxima semana */}
          <section className="dash-noprint">
            <h2 className="mb-3 flex items-center gap-2 font-display text-2xl text-ink">
              <CalendarClock size={18} className="text-gold" /> Próxima semana
            </h2>
            <Card className="p-4">
              {data.proximaSemana.length === 0 ? (
                <p className="p-2 text-sm text-charcoal-soft">Sin eventos el próximo fin de semana.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  {DIAS.map(({ key, label }) => {
                    const dia = data.proximaSemana.filter((e) => e.dia === key);
                    return (
                      <div key={key}>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-charcoal-soft">
                          {label}
                        </p>
                        {dia.length === 0 ? (
                          <p className="text-xs text-charcoal-soft/60">—</p>
                        ) : (
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
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}
