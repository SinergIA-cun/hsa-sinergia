import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Users, MapPin, Printer } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN, formatMXNCents } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Logo } from '../components/Logo.tsx';
import type { Quote, EstadoCuenta, Milestone } from '../lib/types.ts';

interface PublicPago {
  id: string;
  monto: number;
  concepto: string;
  fecha: string;
}

interface PublicResponse {
  quote: Quote;
  estadoCuenta: EstadoCuenta;
}

export function PublicQuotePage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-quote', token],
    queryFn: () => api.get<PublicResponse>(`/api/c/${token}`),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink text-cream">
        <span className="animate-pulse font-display text-3xl">Cargando…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink px-6 text-center text-cream">
        <div>
          <Logo tone="cream" />
          <p className="mt-6 font-display text-2xl">Cotización no encontrada</p>
          <p className="mt-2 text-sm text-cream/60">El enlace pudo haber expirado o ser incorrecto.</p>
        </div>
      </div>
    );
  }

  const { quote, estadoCuenta } = data;
  const fecha = formatEventDate(quote.fechaEvento, 'long');
  const plan: Milestone[] | null = estadoCuenta.plan;
  const pagos = (estadoCuenta.pagos ?? []) as PublicPago[];

  return (
    <div className="min-h-screen bg-paper">
      {/* Hero */}
      <header className="relative overflow-hidden bg-ink text-cream">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 10%, rgba(199,163,103,0.35), transparent 45%), radial-gradient(circle at 90% 90%, rgba(199,163,103,0.15), transparent 40%)',
          }}
        />
        <div className="relative mx-auto max-w-3xl px-6 py-10 text-center sm:py-14">
          <Logo tone="cream" />
          <p className="mt-8 text-xs uppercase tracking-[0.35em] text-gold-200">
            Cotización de evento
          </p>
          <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">
            {quote.client?.nombre}
          </h1>
          <p className="mt-2 font-display text-2xl text-gold-200">{quote.eventType?.nombre}</p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-cream/80">
            <span className="inline-flex items-center gap-2 capitalize">
              <CalendarDays size={16} className="text-gold-200" /> {fecha}
            </span>
            <span className="inline-flex items-center gap-2">
              <Users size={16} className="text-gold-200" /> {quote.invitados} invitados
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-16 pt-10">
        {/* Estado de cuenta */}
        <div className="rounded-[var(--radius-card)] border border-cream-300 bg-white shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-3 divide-x divide-cream-300 text-center">
            <div className="p-6">
              <p className="text-xs uppercase tracking-wide text-charcoal-soft">Total</p>
              <p className="mt-1 font-display text-2xl text-ink">{formatMXN(estadoCuenta.total)}</p>
            </div>
            <div className="p-6">
              <p className="text-xs uppercase tracking-wide text-charcoal-soft">Pagado</p>
              <p className="mt-1 font-display text-2xl text-ink">{formatMXN(estadoCuenta.pagado)}</p>
            </div>
            <div className="bg-ink p-6 text-cream">
              <p className="text-xs uppercase tracking-wide text-gold-200">Saldo</p>
              <p className="mt-1 font-display text-2xl">{formatMXN(estadoCuenta.saldo)}</p>
            </div>
          </div>
        </div>

        {/* Plan de pagos */}
        {!estadoCuenta.planPendiente && plan && plan.length > 0 && (
          <section className="mt-10">
            <div className="mb-4 flex items-center justify-center">
              <span className="divider-arrow text-[0.7rem] uppercase tracking-[0.25em]">
                Plan de pagos
              </span>
            </div>
            <div className="rounded-[var(--radius-card)] border border-cream-300 bg-white/80 p-6 shadow-sm">
              <ul className="space-y-3">
                {plan.map((m) => (
                  <li key={m.key} className="flex items-center justify-between gap-4 text-sm">
                    <span className={m.completo ? 'text-ink' : 'text-charcoal-soft'}>
                      {m.completo ? '✓' : '○'} {m.label}
                      {m.venceISO && (
                        <span className="ml-1 text-xs text-charcoal-soft/60">
                          · vence {formatEventDate(m.venceISO)}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-charcoal">
                      {formatMXN(m.cubierto)} / {formatMXN(m.objetivo)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Pagos */}
        {pagos.length > 0 && (
          <section className="mt-10">
            <div className="mb-4 flex items-center justify-center">
              <span className="divider-arrow text-[0.7rem] uppercase tracking-[0.25em]">
                Pagos
              </span>
            </div>
            <div className="rounded-[var(--radius-card)] border border-cream-300 bg-white/80 p-6 shadow-sm">
              <ul className="divide-y divide-cream-200">
                {pagos.map((p) => (
                  <li key={p.id} className="flex justify-between gap-4 py-2.5 text-sm">
                    <span className="text-charcoal-soft">
                      {formatEventDate(p.fecha)} · {p.concepto}
                    </span>
                    <span className="tabular-nums text-charcoal">{formatMXN(p.monto)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Desglose */}
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-center">
            <span className="divider-arrow text-[0.7rem] uppercase tracking-[0.25em]">
              Desglose
            </span>
          </div>
          <div className="rounded-[var(--radius-card)] border border-cream-300 bg-white/80 p-6 shadow-sm">
            <ul className="divide-y divide-cream-200">
              {quote.breakdown.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-4 py-2.5 text-sm">
                  <span className="text-charcoal-soft">
                    {l.concepto}
                    {l.detalle && (
                      <span className="ml-1 text-xs text-charcoal-soft/60">({l.detalle})</span>
                    )}
                  </span>
                  <span className="tabular-nums text-charcoal">{formatMXNCents(l.monto)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-1 border-t border-cream-300 pt-4 text-sm">
              <div className="flex justify-between text-charcoal-soft">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMXNCents(quote.breakdown.subtotal)}</span>
              </div>
              <div className="flex justify-between text-charcoal-soft">
                <span>IVA</span>
                <span className="tabular-nums">{formatMXNCents(quote.breakdown.iva)}</span>
              </div>
              <div className="flex justify-between pt-1 font-display text-2xl text-ink">
                <span>Total</span>
                <span className="tabular-nums">{formatMXN(quote.breakdown.total)}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="no-print mt-8 text-center">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-ink/20 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-ink/5"
          >
            <Printer size={16} /> Imprimir / Guardar PDF
          </button>
        </div>

        <footer className="mt-12 text-center text-xs text-charcoal-soft">
          <div className="mb-2 inline-flex items-center gap-1.5">
            <MapPin size={13} className="text-gold" />
            Atlacomulco No. 1, Col. San Esteban, Naucalpan, Estado de México
          </div>
          <p>Hacienda San Andrés · Precios con vigencia de 30 días.</p>
        </footer>
      </main>
    </div>
  );
}
