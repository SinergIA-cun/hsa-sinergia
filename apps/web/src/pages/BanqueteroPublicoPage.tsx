import { type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarClock, Coins, MapPin, Printer } from 'lucide-react';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Logo } from '../components/Logo.tsx';
import { STATUS_LABEL } from '../lib/status.ts';
import { useEstadoCuentaPublico } from '../lib/banqueteros.ts';
import { MARCA } from '../lib/marca.ts';

/**
 * El estado de cuenta del banquetero por enlace de solo lectura.
 *
 * Decisión 2 del dueño: sin usuarios externos y sin contraseñas, igual que el
 * contrato del cliente en `/c/:token`. **Esto solo mata el hilo de WhatsApp**:
 * lo que trae a favor, lo que le falta por cubrir y sus eventos.
 *
 * Los DEPÓSITOS no salen aquí. La lista completa deja ver de un vistazo cuánto
 * factura la hacienda con este banquetero al año, y ése es un número de la casa;
 * el reparto se lleva del lado de adentro. Tampoco viene en la respuesta del
 * servidor: no es que se esconda al pintar.
 *
 * Lo que se pinta es la PROYECCIÓN del servidor, no el objeto interno: no hay
 * comprobantes, ni ids, ni motivos de anulación, ni un solo dato de otro
 * banquetero. Aquí no hay ningún botón que escriba.
 */
export function BanqueteroPublicoPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useEstadoCuentaPublico(token ?? '');

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
          <p className="mt-6 font-display text-2xl">Estado de cuenta no encontrado</p>
          <p className="mt-2 text-sm text-cream/60">El enlace pudo haber expirado o ser incorrecto.</p>
        </div>
      </div>
    );
  }

  const { banquetero, eventos, apartados, totales } = data;

  return (
    <div className="min-h-screen bg-paper">
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
          <p className="mt-8 text-xs uppercase tracking-[0.35em] text-gold-200">Estado de cuenta</p>
          <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{banquetero.nombre}</h1>
          <p className="mt-2 font-display text-2xl text-gold-200">
            {totales.eventos} evento{totales.eventos === 1 ? '' : 's'}
            {totales.apartadosVivos > 0 &&
              ` · ${totales.apartadosVivos} fecha${totales.apartadosVivos === 1 ? '' : 's'} apartada${
                totales.apartadosVivos === 1 ? '' : 's'
              }`}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-16 pt-10">
        {/* Los dos números de la cuenta: lo que trae a favor y lo que le falta. */}
        <div className="rounded-[var(--radius-card)] border border-cream-300 bg-white shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 divide-y divide-cream-300 text-center sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="bg-ink p-6 text-cream">
              <p className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gold-200">
                <Coins size={13} /> Saldo a favor
              </p>
              <p className="mt-1 font-display text-2xl">{formatMXN(totales.saldoAFavor)}</p>
            </div>
            <div className="p-6">
              <p className="text-xs uppercase tracking-wide text-charcoal-soft">Saldo por cubrir</p>
              <p
                className={`mt-1 font-display text-2xl ${
                  totales.saldoPorCubrir > 0 ? 'text-wine' : 'text-ink'
                }`}
              >
                {formatMXN(totales.saldoPorCubrir)}
              </p>
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-charcoal-soft">
          El <strong>saldo a favor</strong> es dinero suyo que todavía no se aplica a ningún evento.
          El <strong>saldo por cubrir</strong> es lo que falta de sus eventos, y el plan de pagos
          corresponde a la <strong>renta</strong>.
        </p>

        <Seccion titulo="Sus eventos">
          {eventos.length === 0 ? (
            <p className="text-sm text-charcoal-soft">Todavía no hay eventos cotizados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cream-300 text-left text-xs uppercase tracking-wide text-charcoal-soft">
                    <th className="py-2 pr-3 font-semibold">Evento</th>
                    <th className="py-2 pr-3 font-semibold">Fecha</th>
                    <th className="py-2 pr-3 text-right font-semibold">Renta</th>
                    <th className="py-2 pr-3 text-right font-semibold">Pagado</th>
                    <th className="py-2 text-right font-semibold">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-200">
                  {eventos.map((e) => (
                    <tr key={`${e.folio ?? ''}${e.fechaEventoISO}`}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium text-ink">{e.folio ?? 'Evento'}</span>
                        {e.etiqueta && (
                          <span className="block font-mono text-[0.68rem] text-charcoal-soft">{e.etiqueta}</span>
                        )}
                        <span className="block text-xs text-charcoal-soft">
                          {e.festejado ? `${e.festejado} · ` : ''}
                          {STATUS_LABEL[e.status]}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-charcoal">{formatEventDate(e.fechaEventoISO)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-charcoal">
                        {formatMXN(e.rentaTotal)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-charcoal">
                        {formatMXN(e.pagado)}
                      </td>
                      <td
                        className={`py-2.5 text-right tabular-nums ${
                          e.saldo > 0 ? 'font-semibold text-wine' : 'text-charcoal-soft'
                        }`}
                      >
                        {formatMXN(e.saldo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Seccion>

        {apartados.length > 0 && (
          <Seccion titulo="Fechas apartadas">
            <ul className="space-y-2">
              {apartados.map((a) => (
                <li
                  key={a.fechaEventoISO}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-cream-200 pb-2 text-sm last:border-0 last:pb-0"
                >
                  <span className="font-medium capitalize text-ink">
                    {formatEventDate(a.fechaEventoISO, 'long')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-charcoal-soft">
                    <CalendarClock size={13} /> vence {formatEventDate(a.venceISO)}
                    {a.catalogo ? ` · precio garantizado ${a.catalogo}` : ''}
                    {a.abonado > 0 ? ` · abonado ${formatMXN(a.abonado)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-charcoal-soft">
              Una fecha apartada no tiene precio todavía y dura <strong>siete días hábiles</strong>.
              Si no se convierte en contrato antes de su vencimiento la fecha se libera, y lo que
              haya abonado le queda como <strong>saldo a favor</strong> para su siguiente evento.
            </p>
          </Seccion>
        )}

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
            {MARCA.direccion}
          </div>
          <p>{MARCA.nombre} · Precios con vigencia de 30 días.</p>
        </footer>
      </main>
    </div>
  );
}

/** El divisor editorial de la página pública del cliente, para que se lean igual. */
function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center justify-center">
        <span className="divider-arrow text-[0.7rem] uppercase tracking-[0.25em]">{titulo}</span>
      </div>
      <div className="rounded-[var(--radius-card)] border border-cream-300 bg-white/80 p-6 shadow-sm">
        {children}
      </div>
    </section>
  );
}
