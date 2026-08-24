import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Coins, Phone, Share2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { ArrowDivider, Button, Card } from '../components/ui.tsx';
import { STATUS_LABEL, STATUS_STYLE } from '../lib/status.ts';
import { useEstadoCuentaBanquetero, useInvalidarBanquetero } from '../lib/banqueteros.ts';
import { PRICE_LISTS_KEY } from '../lib/catalogos.ts';
import { DepositosPanel } from '../components/banqueteros/DepositosPanel.tsx';
import { ApartadosPanel } from '../components/banqueteros/ApartadosPanel.tsx';
import { RepartirDepositoModal } from '../components/banqueteros/RepartirDepositoModal.tsx';
import { CompartirBanqueteroModal } from '../components/banqueteros/CompartirBanqueteroModal.tsx';
import { useAuth } from '../auth/auth.tsx';
import type { Catalog, DepositoBanquetero, PriceList } from '../lib/types.ts';

/**
 * La ficha del banquetero: la contraparte con cuenta.
 *
 * Los tres casos del dueño viven aquí. Un banquetero compra varios eventos
 * (la tabla de eventos), hace un depósito y después dice cómo se reparte (los
 * depósitos con su saldo sin asignar), y pide fechas de 2028 sin precio (los
 * apartados).
 *
 * El saldo sin asignar se destaca a propósito: es dinero de la hacienda sin
 * destino y hoy nadie lo puede decir sin sentarse a sumar.
 */
export function BanqueteroPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data, isLoading, isError } = useEstadoCuentaBanquetero(id);
  const invalidar = useInvalidarBanquetero(id);
  const catalogQ = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<Catalog>('/api/catalog'),
  });
  // Los catálogos solo los lista admin (`GET /admin/price-lists` responde 403 a
  // ventas), así que la consulta va apagada para ventas en vez de reintentar un
  // 403 tres veces: el selector de precio garantizado simplemente no aparece.
  // Misma llave que la pantalla de catálogos — clonar uno lo deja disponible aquí
  // sin recargar.
  const priceListsQ = useQuery({
    queryKey: PRICE_LISTS_KEY,
    queryFn: () => api.get<{ priceLists: PriceList[] }>('/api/admin/price-lists'),
    enabled: isAdmin,
  });

  const [repartir, setRepartir] = useState<DepositoBanquetero | null>(null);
  const [compartir, setCompartir] = useState(false);
  const [avisoReparto, setAvisoReparto] = useState('');

  if (isLoading) return <p className="text-charcoal-soft">Cargando la cuenta…</p>;
  if (isError || !data) return <p className="text-wine">No se pudo cargar este banquetero.</p>;

  const { banquetero, eventos, depositos, apartados, apartadosPorVencer, totales } = data;
  const publicUrl = `${window.location.origin}/b/${banquetero.publicToken}`;
  const repartido = totales.depositado - totales.saldoSinAsignar;

  return (
    <div>
      {/* A la cartera, no a `/admin`: esa ruta rebota a ventas y el botón de
          regresar los sacaba a `/cotizaciones` sin explicación. */}
      <Link
        to="/banqueteros"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal-soft hover:text-ink"
      >
        <ArrowLeft size={15} /> Banqueteros
      </Link>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>Cuenta corriente</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">{banquetero.nombre}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-charcoal-soft">
            {banquetero.telefono && (
              <span className="inline-flex items-center gap-1.5">
                <Phone size={13} /> {banquetero.telefono}
              </span>
            )}
            <span>
              {totales.eventos} evento(s) · {totales.apartadosVivos} fecha(s) apartada(s)
            </span>
            {!banquetero.activo && <span className="text-wine">Inactivo</span>}
          </p>
        </div>
        <Button variant="outline" onClick={() => setCompartir(true)}>
          <Share2 size={15} /> QR / enlace
        </Button>
      </div>

      {/* El saldo sin asignar manda: es el número que justifica toda la cuenta. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs uppercase tracking-wide text-charcoal-soft">Depositado</p>
          <p className="mt-1 font-display text-2xl text-ink">{formatMXN(totales.depositado)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs uppercase tracking-wide text-charcoal-soft">Ya repartido</p>
          <p className="mt-1 font-display text-2xl text-ink">{formatMXN(repartido)}</p>
        </Card>
        <div
          className={`rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)] ${
            totales.saldoSinAsignar > 0
              ? 'border-l-4 border-gold bg-gold/15'
              : 'border border-cream-300/80 bg-white/80'
          }`}
        >
          <p className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-charcoal-soft">
            <Coins size={13} /> Sin asignar
          </p>
          <p
            className={`mt-1 font-display text-3xl ${
              totales.saldoSinAsignar > 0 ? 'text-gold' : 'text-charcoal-soft'
            }`}
          >
            {formatMXN(totales.saldoSinAsignar)}
          </p>
          {totales.saldoSinAsignar > 0 && (
            <p className="mt-1 text-[0.7rem] text-charcoal-soft">
              Dinero recibido sin destino. No cuenta como pagado en ningún evento.
            </p>
          )}
        </div>
        <Card className="p-5">
          <p className="text-xs uppercase tracking-wide text-charcoal-soft">Saldo de sus eventos</p>
          <p className="mt-1 font-display text-2xl text-ink">{formatMXN(totales.saldo)}</p>
          <p className="mt-1 text-[0.7rem] text-charcoal-soft">
            De {formatMXN(totales.rentaTotal)} de renta contratada.
          </p>
        </Card>
      </div>

      {apartadosPorVencer.length > 0 && (
        <div className="mt-6 rounded-[var(--radius-card)] border-l-4 border-wine bg-wine/[0.05] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-wine">
            <CalendarClock size={15} />
            {apartadosPorVencer.length} apartado(s) por vencer en los próximos 30 días
          </p>
          <p className="mt-1 text-xs text-charcoal-soft">
            {apartadosPorVencer
              .map((a) => `${formatEventDate(a.fechaEvento)} (vence ${formatEventDate(a.vence)})`)
              .join(' · ')}
          </p>
        </div>
      )}

      {avisoReparto && (
        <p className="mt-6 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-ink">
          {avisoReparto}
        </p>
      )}

      <section className="mt-10">
        <h2 className="mb-3 font-display text-2xl text-ink">Sus eventos</h2>
        {eventos.length === 0 ? (
          <Card className="p-6 text-sm text-charcoal-soft">
            Todavía no tiene eventos cotizados. Con banquetero, ÉL es el cliente de la hacienda:
            firma él y se le factura a él.
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cream-300 bg-cream-100 text-left text-xs uppercase tracking-wide text-charcoal-soft">
                  <th className="px-4 py-2.5 font-semibold">Evento</th>
                  <th className="px-4 py-2.5 font-semibold">Fecha</th>
                  <th className="px-4 py-2.5 font-semibold">Festejado</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Renta</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Pagado</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Saldo</th>
                  <th className="px-4 py-2.5 font-semibold">Estatus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-200">
                {eventos.map((e) => (
                  <tr
                    key={e.quoteId}
                    className="cursor-pointer transition-colors hover:bg-cream-50"
                    onClick={() => navigate(`/cotizaciones/${e.quoteId}`)}
                  >
                    <td className="px-4 py-2.5 font-medium text-ink">{e.codigo ?? '—'}</td>
                    <td className="px-4 py-2.5 text-charcoal">{formatEventDate(e.fechaEventoISO)}</td>
                    <td className="px-4 py-2.5 text-charcoal-soft">{e.festejado ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-charcoal">
                      {formatMXN(e.rentaTotal)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-charcoal">
                      {formatMXN(e.pagado)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums ${
                        e.saldo > 0 ? 'font-semibold text-wine' : 'text-charcoal-soft'
                      }`}
                    >
                      {formatMXN(e.saldo)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${STATUS_STYLE[e.status]}`}
                      >
                        {STATUS_LABEL[e.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-display text-2xl text-ink">Depósitos a cuenta</h2>
        <DepositosPanel
          banqueteroId={id}
          depositos={depositos}
          isAdmin={isAdmin}
          onCambio={async () => {
            setAvisoReparto('');
            await invalidar();
          }}
          onRepartir={(d) => setRepartir(d)}
        />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-display text-2xl text-ink">Fechas apartadas</h2>
        <ApartadosPanel
          banqueteroId={id}
          banqueteroNombre={banquetero.nombre}
          apartados={apartados}
          spaces={catalogQ.data?.spaces ?? []}
          priceLists={priceListsQ.data?.priceLists ?? []}
          isAdmin={isAdmin}
          onCambio={invalidar}
        />
      </section>

      {repartir && (
        <RepartirDepositoModal
          // El depósito se re-lee de la respuesta fresca: si otra pestaña ya
          // repartió parte, el modal tiene que abrir con el saldo de verdad.
          deposito={depositos.find((d) => d.id === repartir.id) ?? repartir}
          eventos={eventos}
          onCancel={() => setRepartir(null)}
          onSaved={async (pagos) => {
            setRepartir(null);
            setAvisoReparto(
              `Se crearon ${pagos.length} pago(s): ${pagos
                .map((p) => `recibo #${p.folio} por ${formatMXN(p.monto)}`)
                .join(' · ')}.`,
            );
            await invalidar();
          }}
        />
      )}

      {compartir && (
        <CompartirBanqueteroModal
          nombre={banquetero.nombre}
          telefono={banquetero.telefono}
          publicUrl={publicUrl}
          onClose={() => setCompartir(false)}
        />
      )}
    </div>
  );
}
