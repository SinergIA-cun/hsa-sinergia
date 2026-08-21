import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookmarkPlus, CalendarClock } from 'lucide-react';
import { api, ApiError } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Card, Field, SelectInput, TextInput } from '../ui.tsx';
import { apiErrorMessage } from '../admin/shared.tsx';
import { ConvertirApartadoModal } from './ConvertirApartadoModal.tsx';
import type { ApartadoFecha, PaymentMethod, PriceList, Space } from '../../lib/types.ts';

const METODOS: PaymentMethod[] = ['transferencia', 'efectivo', 'tarjeta'];

interface Props {
  banqueteroId: string;
  banqueteroNombre: string;
  apartados: ApartadoFecha[];
  spaces: Space[];
  /** Catálogos para el precio garantizado. Vacío para ventas: el listado es de admin. */
  priceLists: PriceList[];
  isAdmin: boolean;
  onCambio: () => Promise<void>;
}

/** Qué es este apartado hoy: es lo que decide si bloquea la fecha. */
function estado(a: ApartadoFecha): { label: string; clase: string } {
  if (a.quoteId) return { label: 'Convertido', clase: 'bg-ink text-cream' };
  if (a.canceladoAt) return { label: 'Cancelado', clase: 'bg-cream-200 text-charcoal-soft' };
  if (a.vencido) return { label: 'Vencido', clase: 'bg-wine/15 text-wine' };
  return { label: 'Aparta la fecha', clase: 'bg-gold/25 text-gold' };
}

/**
 * Las fechas apartadas sin precio: el caso 3 del dueño.
 *
 * "Piden fechas muy adelantadas: están pidiendo 2028 y pagando fechas aún sin
 * tener claros los precios." Un apartado bloquea la fecha igual que un evento
 * comprometido, pero NO tiene total: no es una venta cerrada y no entra a ningún
 * número de ingreso.
 */
export function ApartadosPanel({
  banqueteroId,
  banqueteroNombre,
  apartados,
  spaces,
  priceLists,
  isAdmin,
  onCambio,
}: Props) {
  const nombreEspacio = (id: string) => spaces.find((s) => s.id === id)?.nombre ?? id;

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-3">
        {apartados.length === 0 ? (
          <Card className="p-6 text-sm text-charcoal-soft">
            Este banquetero no tiene fechas apartadas.
          </Card>
        ) : (
          apartados.map((a) => (
            <ApartadoRow
              key={a.id}
              apartado={a}
              banqueteroNombre={banqueteroNombre}
              nombreEspacio={nombreEspacio}
              isAdmin={isAdmin}
              onCambio={onCambio}
            />
          ))
        )}
      </div>
      <CrearApartado
        banqueteroId={banqueteroId}
        spaces={spaces}
        priceLists={priceLists}
        isAdmin={isAdmin}
        onCambio={onCambio}
      />
    </div>
  );
}

function ApartadoRow({
  apartado: a,
  banqueteroNombre,
  nombreEspacio,
  isAdmin,
  onCambio,
}: {
  apartado: ApartadoFecha;
  banqueteroNombre: string;
  nombreEspacio: (id: string) => string;
  isAdmin: boolean;
  onCambio: () => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [armado, setArmado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const e = estado(a);
  const [convertir, setConvertir] = useState(false);

  async function cancelar() {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/banqueteros/apartados/${a.id}/cancelar`, { motivo: motivo.trim() });
      setArmado(false);
      setMotivo('');
      await onCambio();
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo cancelar el apartado.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={`p-4 ${a.vivo ? '' : 'opacity-70'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {formatEventDate(a.fechaEvento, 'long')}
          </p>
          <p className="text-xs text-charcoal-soft">
            {a.spaceIds.map(nombreEspacio).join(' y ')}
            {a.priceList ? ` · precio garantizado ${a.priceList.nombre}` : ' · sin precio garantizado'}
          </p>
          <p className="mt-1 text-xs text-charcoal-soft">
            Vence {formatEventDate(a.vence)}
            {a.deposito > 0 ? ` · depósito ${formatMXN(a.deposito)}` : ' · sin depósito'}
          </p>
          {a.nota && <p className="mt-1 text-xs italic text-charcoal-soft">{a.nota}</p>}
          {a.quote && (
            <p className="mt-1 text-xs">
              <Link
                to={`/cotizaciones/${a.quote.id}`}
                className="font-medium text-gold hover:underline"
              >
                {a.quote.codigo ?? 'Ver la cotización'}
              </Link>
            </p>
          )}
          {a.canceladoAt && a.motivoCancelacion && (
            <p className="mt-1 text-xs text-wine">Cancelado: {a.motivoCancelacion}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${e.clase}`}>
            {e.label}
          </span>
          {a.vivo && !armado && (
            <button
              type="button"
              className="text-xs font-medium text-gold hover:underline"
              onClick={() => setConvertir(true)}
            >
              Convertir en cotización
            </button>
          )}
          {isAdmin && a.vivo && !armado && (
            <button
              type="button"
              className="text-xs text-wine hover:underline"
              onClick={() => setArmado(true)}
            >
              Cancelar apartado
            </button>
          )}
        </div>
      </div>

      {convertir && (
        <ConvertirApartadoModal
          apartado={a}
          banqueteroNombre={banqueteroNombre}
          nombreEspacio={nombreEspacio}
          onListo={onCambio}
          onCerrar={() => setConvertir(false)}
        />
      )}

      {armado && (
        <div className="mt-3 space-y-2 rounded-lg border border-wine/30 bg-wine/5 p-3">
          <Field label="Motivo de la cancelación" hint="La fecha se libera para otro evento.">
            <TextInput
              autoFocus
              value={motivo}
              onChange={(ev) => setMotivo(ev.target.value)}
              placeholder="ej. el banquetero ya no la va a usar"
            />
          </Field>
          {error && (
            <p role="alert" className="text-xs text-wine">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              className="px-3 py-1.5 text-xs"
              onClick={() => {
                setArmado(false);
                setError('');
              }}
            >
              Cancela
            </Button>
            <Button
              variant="ghost"
              className="bg-wine px-3 py-1.5 text-xs text-cream hover:bg-wine/90"
              disabled={busy || motivo.trim().length < 3}
              onClick={cancelar}
            >
              {busy ? 'Cancelando…' : 'Sí, liberar la fecha'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const MAX_ESPACIOS = 3;

/**
 * Apartar una fecha. Lo puede hacer ventas: es vender una fecha, no mover dinero
 * ya recibido.
 *
 * El choque con una fecha ya comprometida AVISA y no bloquea, igual que los
 * empalmes: el servidor responde 409 con el detalle y se vuelve a mandar con
 * `confirmar`. Negarse a apartar una fecha por la que ya entró un depósito sería
 * peor que un empalme visible.
 */
function CrearApartado({
  banqueteroId,
  spaces,
  priceLists,
  isAdmin,
  onCambio,
}: {
  banqueteroId: string;
  spaces: Space[];
  priceLists: PriceList[];
  isAdmin: boolean;
  onCambio: () => Promise<void>;
}) {
  const [fechaEvento, setFechaEvento] = useState('');
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [vence, setVence] = useState('');
  const [priceListId, setPriceListId] = useState('');
  const [deposito, setDeposito] = useState('');
  const [depositoMetodo, setDepositoMetodo] = useState<PaymentMethod>('transferencia');
  const [depositoFecha, setDepositoFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [choque, setChoque] = useState('');
  const [busy, setBusy] = useState(false);

  const depositoNum = deposito.trim() === '' ? 0 : Number(deposito);
  const depositoValido = deposito.trim() === '' || /^\d+$/.test(deposito.trim());
  const listo = fechaEvento !== '' && vence !== '' && spaceIds.length > 0 && depositoValido;

  function toggle(id: string) {
    setSpaceIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_ESPACIOS ? ids : [...ids, id],
    );
  }

  async function enviar(confirmar: boolean) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/banqueteros/${banqueteroId}/apartados`, {
        fechaEvento,
        spaceIds,
        vence,
        priceListId: priceListId || null,
        deposito: depositoNum,
        // La forma de pago y la fecha de RECEPCIÓN solo viajan si hay depósito:
        // son obligatorias entonces porque el pago que nace al convertir hereda
        // esa fecha, no la de la conversión.
        depositoMetodo: depositoNum > 0 ? depositoMetodo : null,
        depositoFecha: depositoNum > 0 ? depositoFecha : null,
        nota: nota.trim() || null,
        confirmar,
      });
      setFechaEvento('');
      setSpaceIds([]);
      setVence('');
      setPriceListId('');
      setDeposito('');
      setNota('');
      setChoque('');
      await onCambio();
    } catch (err) {
      // 409 = la fecha ya está comprometida. Avisa con el detalle del servidor y
      // deja el camino de confirmar abierto.
      if (err instanceof ApiError && err.status === 409 && !confirmar) setChoque(err.message);
      else setError(apiErrorMessage(err, 'No se pudo apartar la fecha.'));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!listo) return;
    void enviar(false);
  }

  return (
    <Card className="h-fit space-y-4 p-6">
      <h3 className="flex items-center gap-2 font-display text-lg text-ink">
        <BookmarkPlus size={16} className="text-gold" /> Apartar una fecha
      </h3>
      <p className="text-xs text-charcoal-soft">
        Bloquea la fecha sin cotización ni precio. Vence: un apartado que no se convierte libera la
        fecha.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Fecha del evento">
          <TextInput type="date" value={fechaEvento} onChange={(e) => setFechaEvento(e.target.value)} />
        </Field>
        <Field label={`Espacios (hasta ${MAX_ESPACIOS})`}>
          <div className="grid gap-1.5">
            {spaces.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  spaceIds.includes(s.id) ? 'border-gold bg-gold/10 text-ink' : 'border-ink/12 bg-white/50'
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-gold)]"
                  checked={spaceIds.includes(s.id)}
                  onChange={() => toggle(s.id)}
                />
                {s.nombre}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Vence el" hint="Después de esta fecha la disponibilidad se libera sola.">
          <TextInput type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
        </Field>
        {isAdmin && priceLists.length > 0 && (
          <Field
            label="Precio garantizado (opcional)"
            hint="El catálogo que se le congela. La cotización que nazca de aquí lo hereda."
          >
            <SelectInput value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
              <option value="">Sin precio garantizado</option>
              {priceLists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        <Field label="Depósito (opcional, pesos enteros)">
          <TextInput
            inputMode="numeric"
            value={deposito}
            onChange={(e) => setDeposito(e.target.value)}
            placeholder="0"
            className="tabular-nums"
          />
        </Field>
        {depositoNum > 0 && (
          <>
            <Field label="Forma de pago del depósito">
              <SelectInput
                value={depositoMetodo}
                onChange={(e) => setDepositoMetodo(e.target.value as PaymentMethod)}
              >
                {METODOS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field
              label="Fecha en que se recibió"
              hint="Al convertir, el pago lleva esta fecha, no la de la conversión."
            >
              <TextInput
                type="date"
                value={depositoFecha}
                onChange={(e) => setDepositoFecha(e.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="Nota (opcional)">
          <TextInput value={nota} onChange={(e) => setNota(e.target.value)} placeholder="ej. graduación 2028" />
        </Field>

        {!depositoValido && <p className="text-xs text-wine">El depósito va en pesos enteros.</p>}

        {choque && (
          <div className="space-y-2 rounded-lg border border-wine/30 bg-wine/5 p-3">
            <p className="flex items-start gap-2 text-sm text-wine">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {choque}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setChoque('')}>
                Cancela
              </Button>
              <Button
                type="button"
                variant="gold"
                className="px-3 py-1.5 text-xs"
                disabled={busy}
                onClick={() => void enviar(true)}
              >
                Apartar de todos modos
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-wine">
            {error}
          </p>
        )}

        <Button type="submit" variant="gold" disabled={!listo || busy}>
          <CalendarClock size={15} /> {busy ? 'Apartando…' : 'Apartar la fecha'}
        </Button>
      </form>
    </Card>
  );
}
