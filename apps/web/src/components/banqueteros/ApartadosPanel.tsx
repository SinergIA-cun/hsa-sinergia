import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookmarkPlus, CalendarClock } from 'lucide-react';
import { api, ApiError } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Card, Field, MoneyInput, SelectInput, TextInput } from '../ui.tsx';
import { apiErrorMessage } from '../admin/shared.tsx';
import { hoyCivilMexico, vigenciaDeApartado } from '@hsa/shared';
import { AbonosApartado } from './AbonosApartado.tsx';
import { FormasPagoCampo, errorFormas, formasIniciales, formasParaEnviar } from '../FormasPagoCampo.tsx';
import type { ApartadoFecha, PriceList, Space } from '../../lib/types.ts';

interface Props {
  banqueteroId: string;
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
              banqueteroId={banqueteroId}
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

export function ApartadoRow({
  apartado: a,
  banqueteroId,
  nombreEspacio,
  isAdmin,
  onCambio,
  mostrarTitular = false,
}: {
  apartado: ApartadoFecha;
  /** El banquetero de cuya cuenta se ve. `null` en la ficha de un apartado de cliente. */
  banqueteroId: string | null;
  /** En la ficha suelta se dice quién apartó; en la cuenta del banquetero sobra. */
  mostrarTitular?: boolean;
  nombreEspacio: (id: string) => string;
  isAdmin: boolean;
  onCambio: () => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [armado, setArmado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const e = estado(a);

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

  /**
   * Otros siete días hábiles. Si la fecha ya se comprometió mientras el apartado
   * estaba vencido, la API contesta 409 y aquí se pregunta antes de insistir:
   * revivirlo a ciegas volvería a bloquear una fecha que la casa ya vendió.
   */
  async function renovar(confirmar: boolean) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/banqueteros/apartados/${a.id}/renovar`, { confirmar });
      await onCambio();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !confirmar) {
        if (window.confirm(`${apiErrorMessage(err, '')}\n\n¿Renovar de todos modos?`)) {
          setBusy(false);
          return renovar(true);
        }
      } else {
        setError(apiErrorMessage(err, 'No se pudo renovar el apartado.'));
      }
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
          {mostrarTitular && (
            <p className="text-sm text-ink">
              {a.banquetero ? `Banquetero: ${a.banquetero.nombre}` : `Cliente: ${a.client?.nombre ?? '—'}`}
            </p>
          )}
          <p className="text-xs text-charcoal-soft">
            {a.spaceIds.map(nombreEspacio).join(' y ')}
            {a.priceList ? ` · precio garantizado ${a.priceList.nombre}` : ' · sin precio garantizado'}
          </p>
          <p className="mt-1 text-xs text-charcoal-soft">
            Vence {formatEventDate(a.vence)}
            {a.abonado > 0 ? ` · abonado ${formatMXN(a.abonado)}` : ' · sin abonos'}
          </p>
          {(a.eventType || a.precioAcordado != null) && (
            <p className="mt-1 text-xs text-ink">
              {[a.eventType?.nombre, a.precioAcordado != null ? `precio acordado ${formatMXN(a.precioAcordado)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          {a.nota && <p className="mt-1 text-xs italic text-charcoal-soft">{a.nota}</p>}
          {a.quote && (
            <p className="mt-1 text-xs">
              <Link
                to={`/eventos/${a.quote.id}`}
                className="font-medium text-gold hover:underline"
              >
                {a.quote.etiqueta ?? a.quote.folio ?? 'Ver la cotización'}
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
            /* Una PANTALLA y no un modal: convertir es armar el contrato
               completo —tipo de evento, invitados, alimentos, servicios— con su
               desglose en vivo, y eso no cabe en una ventanita. */
            <Link
              to={banqueteroId ? `/banqueteros/${banqueteroId}/apartados/${a.id}/convertir` : `/apartados/${a.id}/convertir`}
              className="text-xs font-medium text-gold hover:underline"
            >
              Convertir en contrato
            </Link>
          )}
          {/*
            Renovar existe porque el plazo dejó de capturarse. Sin salida, un
            "dame una semana más" solo se resolvía cancelando y volviendo a
            apartar, y con eso se perdía el rastro del dinero que ya había
            entrado a esa fecha. No pide fecha: da el plazo de la casa.
            Aparece también en los VENCIDOS, que es cuando más se pide.
          */}
          {/* Uno que vino del BI vive hasta su fecha: renovarlo no le daría nada. */}
          {isAdmin && !a.quote && !a.canceladoAt && !armado && !(a.importadoBI && a.vivo) && (
            <button
              type="button"
              className="text-xs font-medium text-ink hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={() => void renovar(false)}
            >
              {a.vivo ? 'Renovar 7 días hábiles' : 'Revivir 7 días hábiles'}
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

      <AbonosApartado apartado={a} onCambio={onCambio} />

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
  const [priceListId, setPriceListId] = useState('');
  const [deposito, setDeposito] = useState('');
  const [depositoFormas, setDepositoFormas] = useState(() => formasIniciales());
  const [depositoFecha, setDepositoFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [choque, setChoque] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * Lo que va a quedar al guardar. Se calcula con `vigenciaDeApartado`, la misma
   * pieza que usa la API: si cada lado lo calculara por su cuenta, tarde o
   * temprano la pantalla prometería un día y la base guardaría otro.
   */
  const venceCalculado = vigenciaDeApartado(hoyCivilMexico()).toISOString().slice(0, 10);

  const depositoNum = deposito.trim() === '' ? 0 : Number(deposito);
  const depositoValido = deposito.trim() === '' || /^\d+$/.test(deposito.trim());
  const listo = fechaEvento !== '' && spaceIds.length > 0 && depositoValido;

  function toggle(id: string) {
    setSpaceIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_ESPACIOS ? ids : [...ids, id],
    );
  }

  async function enviar(confirmar: boolean) {
    const errorDeFormas = depositoNum > 0 ? errorFormas(depositoFormas, depositoNum) : null;
    if (errorDeFormas) {
      setError(errorDeFormas);
      return;
    }
    setBusy(true);
    setError('');
    const envioFormas = formasParaEnviar(depositoFormas);
    try {
      await api.post(`/api/banqueteros/${banqueteroId}/apartados`, {
        fechaEvento,
        spaceIds,
        priceListId: priceListId || null,
        deposito: depositoNum,
        // La forma de pago y la fecha de RECEPCIÓN solo viajan si hay depósito:
        // son obligatorias entonces porque el pago que nace al convertir hereda
        // esa fecha, no la de la conversión.
        depositoMetodo: depositoNum > 0 ? (envioFormas.metodo ?? null) : null,
        depositoFormas: depositoNum > 0 ? (envioFormas.formas ?? null) : null,
        depositoFecha: depositoNum > 0 ? depositoFecha : null,
        nota: nota.trim() || null,
        confirmar,
      });
      setFechaEvento('');
      setSpaceIds([]);
      setPriceListId('');
      setDeposito('');
      setDepositoFormas(formasIniciales());
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
        {/*
          El plazo ya no se captura.
          Antes era un campo de fecha y un plazo que cada quien teclea no es un
          plazo: era una negociación por apartado, imposible de sostener igual
          para todos. Se calcula aquí con la MISMA función que usa el servidor al
          guardar, para que lo que promete la pantalla y lo que queda en la base
          no puedan decir cosas distintas.
        */}
        <div className="rounded-lg border border-cream-300 bg-cream-100 px-3.5 py-3 text-sm">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-charcoal-soft">
            <CalendarClock size={13} /> Vence el
          </p>
          <p className="mt-1 font-medium capitalize text-ink">{formatEventDate(venceCalculado, 'long')}</p>
          <p className="mt-1 text-xs text-charcoal-soft">
            Siete días hábiles, contados solos. No cuentan sábados, domingos ni días de descanso
            obligatorio. Después de esa fecha la disponibilidad se libera sola y lo que haya
            abonado le queda como saldo a favor.
          </p>
        </div>
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
          <MoneyInput value={deposito} onValue={setDeposito} placeholder="0" />
        </Field>
        {depositoNum > 0 && (
          <>
            <FormasPagoCampo value={depositoFormas} onChange={setDepositoFormas} monto={depositoNum} />
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
