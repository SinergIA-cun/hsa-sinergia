import { useState, type FormEvent } from 'react';
import { Coins, Plus, X } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { useAuth } from '../../auth/auth.tsx';
import { Button, Field, MoneyInput, SelectInput, TextInput } from '../ui.tsx';
import { apiErrorMessage } from '../admin/shared.tsx';
import type { AbonoApartado, ApartadoFecha, PaymentMethod } from '../../lib/types.ts';

const METODOS: PaymentMethod[] = ['efectivo', 'transferencia', 'tarjeta'];

/**
 * Los abonos de una fecha apartada.
 *
 * Aquí NO hay saldo pendiente ni plan de pagos, y no es un olvido: un apartado no
 * tiene precio —2029 no tiene catálogo, ni PAX, ni tipo de evento— así que no hay
 * contra qué restar. Lo que hay es un acumulado a favor de esa fecha, que es
 * exactamente lo que el banquetero va juntando durante dos años.
 *
 * El precio aparece al convertirla en cotización, y ahí cada abono se vuelve un
 * pago con la fecha en que entró.
 */
export function AbonosApartado({
  apartado,
  onCambio,
}: {
  apartado: ApartadoFecha;
  onCambio: () => Promise<void>;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [abriendo, setAbriendo] = useState(false);

  const vivos = apartado.abonos.filter((a) => a.anuladoAt == null);
  // Ya convertido o cancelado, la fecha no recibe más dinero: los pagos van a la
  // cotización, o no hay a dónde mandarlos.
  const puedeRecibir = apartado.quoteId == null && apartado.canceladoAt == null;

  return (
    <div className="mt-3 border-t border-cream-200 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal-soft">
          <Coins size={12} className="text-gold" />
          Abonos {vivos.length > 0 && `· ${formatMXN(apartado.abonado)} juntados`}
        </p>
        {isAdmin && puedeRecibir && (
          <Button
            type="button"
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={() => setAbriendo((v) => !v)}
          >
            {abriendo ? <X size={12} /> : <Plus size={12} />}
            {abriendo ? 'Cerrar' : 'Abonar'}
          </Button>
        )}
      </div>

      {apartado.abonos.length === 0 ? (
        <p className="mt-1 text-xs text-charcoal-soft">
          Todavía no ha abonado nada a esta fecha.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {apartado.abonos.map((a) => (
            <Renglon key={a.id} abono={a} isAdmin={isAdmin} onCambio={onCambio} />
          ))}
        </ul>
      )}

      {abriendo && <FormaAbono apartadoId={apartado.id} onListo={onCambio} onCerrar={() => setAbriendo(false)} />}
    </div>
  );
}

function Renglon({
  abono,
  isAdmin,
  onCambio,
}: {
  abono: AbonoApartado;
  isAdmin: boolean;
  onCambio: () => Promise<void>;
}) {
  const [armado, setArmado] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const anulado = abono.anuladoAt != null;

  async function anular() {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/banqueteros/abonos/${abono.id}/anular`, { motivo: motivo.trim() });
      setArmado(false);
      setMotivo('');
      await onCambio();
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo anular el abono.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="text-xs">
      <div className={`flex flex-wrap items-center justify-between gap-2 ${anulado ? 'text-charcoal-soft line-through' : 'text-ink'}`}>
        <span className="tabular-nums">
          {formatEventDate(abono.fecha)} · <strong>{formatMXN(abono.monto)}</strong>{' '}
          <span className="text-charcoal-soft">{abono.metodo}</span>
          {/* De dónde salió: el saldo del banquetero o un pago directo a la fecha. */}
          {abono.pagoBanqueteroId && (
            <span className="ml-1 rounded bg-gold/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-gold">
              de su saldo
            </span>
          )}
          {abono.paymentId && (
            <span className="ml-1 rounded bg-emerald-600/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-emerald-700">
              ya es pago
            </span>
          )}
        </span>
        {/* Un abono ya convertido se corrige desde su pago, no desde aquí. */}
        {isAdmin && !anulado && !abono.paymentId && !armado && (
          <button type="button" className="text-[0.7rem] text-wine hover:underline" onClick={() => setArmado(true)}>
            Anular
          </button>
        )}
      </div>
      {anulado && abono.motivoAnulacion && (
        <p className="text-[0.7rem] text-wine">Anulado: {abono.motivoAnulacion}</p>
      )}
      {armado && (
        <div className="mt-1 space-y-1 rounded border border-wine/30 bg-wine/5 p-2">
          <TextInput
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (ej. el cheque rebotó)"
            className="py-1 text-xs"
          />
          {error && <p className="text-[0.7rem] text-wine">{error}</p>}
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              className="bg-wine px-2 py-1 text-[0.7rem] text-cream hover:bg-wine/90"
              disabled={busy || motivo.trim().length < 3}
              onClick={anular}
            >
              Anular
            </Button>
            <Button type="button" variant="ghost" className="px-2 py-1 text-[0.7rem]" onClick={() => setArmado(false)}>
              Cancela
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Un abono directo: alguien pagó ESTA fecha, no la cuenta del banquetero. */
function FormaAbono({
  apartadoId,
  onListo,
  onCerrar,
}: {
  apartadoId: string;
  onListo: () => Promise<void>;
  onCerrar: () => void;
}) {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [referencia, setReferencia] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valido = /^\d+$/.test(monto.trim()) && Number(monto) > 0 && fecha !== '';

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/banqueteros/apartados/${apartadoId}/abonos`, {
        monto: Number(monto),
        metodo,
        fecha,
        referencia: referencia.trim() || undefined,
      });
      setMonto('');
      setReferencia('');
      await onListo();
      onCerrar();
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo registrar el abono.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={guardar} className="mt-2 grid gap-2 rounded-lg border border-cream-300 bg-white/60 p-3 sm:grid-cols-2">
      <Field label="Monto">
        <MoneyInput value={monto} onValue={setMonto} placeholder="0" className="py-1.5 text-sm" />
      </Field>
      <Field label="Fecha en que se recibió" hint="No la de captura: el ingreso se factura en su mes.">
        <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="py-1.5 text-sm" />
      </Field>
      <Field label="Forma de pago">
        <SelectInput
          value={metodo}
          onChange={(e) => setMetodo(e.target.value as PaymentMethod)}
          className="py-1.5 text-sm"
        >
          {METODOS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Referencia (opcional)">
        <TextInput value={referencia} onChange={(e) => setReferencia(e.target.value)} className="py-1.5 text-sm" />
      </Field>
      {error && <p className="text-xs text-wine sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" variant="gold" className="px-3 py-1.5 text-xs" disabled={!valido || busy}>
          {busy ? 'Guardando…' : 'Guardar abono'}
        </Button>
      </div>
    </form>
  );
}
