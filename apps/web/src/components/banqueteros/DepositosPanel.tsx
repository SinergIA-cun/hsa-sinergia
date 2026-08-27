import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Ban, FileImage, Paperclip, Split } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Card, Field, MoneyInput, SelectInput, TextInput } from '../ui.tsx';
import { apiErrorMessage } from '../admin/shared.tsx';
import type { DepositoBanquetero, PaymentMethod } from '../../lib/types.ts';

const METODOS: PaymentMethod[] = ['transferencia', 'efectivo', 'tarjeta'];

interface Props {
  banqueteroId: string;
  depositos: DepositoBanquetero[];
  isAdmin: boolean;
  onCambio: () => Promise<void>;
  onRepartir: (deposito: DepositoBanquetero) => void;
}

/**
 * Los depósitos del banquetero, con su reparto y lo que sigue sin destino.
 *
 * Cada asignación es un `Payment` de verdad, así que se enseña su folio de recibo
 * y se puede abrir el contrato del evento: es el mismo dinero visto desde la otra
 * punta.
 */
export function DepositosPanel({ banqueteroId, depositos, isAdmin, onCambio, onRepartir }: Props) {
  const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-4">
        {depositos.length === 0 ? (
          <Card className="p-6 text-sm text-charcoal-soft">
            Todavía no hay depósitos a cuenta de este banquetero.
          </Card>
        ) : (
          depositos.map((d) => (
            <DepositoCard
              key={d.id}
              deposito={d}
              isAdmin={isAdmin}
              apiBase={apiBase}
              onCambio={onCambio}
              onRepartir={() => onRepartir(d)}
            />
          ))
        )}
      </div>
      {isAdmin && <RegistrarDeposito banqueteroId={banqueteroId} apiBase={apiBase} onCambio={onCambio} />}
    </div>
  );
}

function DepositoCard({
  deposito: d,
  isAdmin,
  apiBase,
  onCambio,
  onRepartir,
}: {
  deposito: DepositoBanquetero;
  isAdmin: boolean;
  apiBase: string;
  onCambio: () => Promise<void>;
  onRepartir: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [anulando, setAnulando] = useState<{ tipo: 'deposito' | 'asignacion'; id: string } | null>(null);
  const [motivo, setMotivo] = useState('');

  const vivas = d.asignaciones.filter((a) => a.anuladoAt == null);

  async function confirmarAnulacion() {
    if (!anulando || motivo.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      const url =
        anulando.tipo === 'deposito'
          ? `/api/banqueteros/depositos/${d.id}/anular`
          : `/api/banqueteros/depositos/${d.id}/asignaciones/${anulando.id}/anular`;
      await api.patch(url, { motivo: motivo.trim() });
      setAnulando(null);
      setMotivo('');
      await onCambio();
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo anular.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={`p-5 ${d.anuladoAt ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-2xl text-ink">{formatMXN(d.monto)}</p>
          <p className="text-xs text-charcoal-soft">
            Recibido {formatEventDate(d.fecha)} · {d.metodo}
            {d.referencia ? ` · ${d.referencia}` : ''}
          </p>
          {d.anuladoAt && (
            <p className="mt-1 text-xs font-semibold text-wine">
              Anulado{d.motivoAnulacion ? `: ${d.motivoAnulacion}` : ''}
            </p>
          )}
        </div>
        {!d.anuladoAt && (
          <div className="text-right">
            <p className="text-[0.7rem] uppercase tracking-wide text-charcoal-soft">Sin asignar</p>
            <p
              className={`font-display text-xl tabular-nums ${
                d.saldoSinAsignar > 0 ? 'text-gold' : 'text-charcoal-soft'
              }`}
            >
              {formatMXN(d.saldoSinAsignar)}
            </p>
          </div>
        )}
      </div>

      {d.asignaciones.length > 0 && (
        <ul className="mt-4 divide-y divide-cream-200 border-t border-cream-200 pt-1">
          {d.asignaciones.map((a) => (
            <li
              key={a.id}
              className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm ${
                a.anuladoAt ? 'text-charcoal-soft line-through' : ''
              }`}
            >
              <span className="min-w-0">
                <Link
                  to={`/cotizaciones/${a.quoteId}`}
                  className="font-medium text-ink hover:text-gold hover:underline"
                >
                  {a.quote?.codigo ?? 'Evento'}
                </Link>
                <span className="ml-2 text-xs text-charcoal-soft">
                  recibo #{a.folio} · {a.concepto}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-charcoal">{formatMXN(a.monto)}</span>
                {isAdmin && !a.anuladoAt && !d.anuladoAt && (
                  <button
                    type="button"
                    className="text-xs text-wine hover:underline"
                    onClick={() => {
                      setAnulando({ tipo: 'asignacion', id: a.id });
                      setMotivo('');
                    }}
                  >
                    Anular
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!d.anuladoAt && d.saldoSinAsignar > 0 && (
          <Button variant="gold" className="px-3 py-1.5 text-xs" onClick={onRepartir}>
            <Split size={13} /> Repartir {formatMXN(d.saldoSinAsignar)}
          </Button>
        )}
        {d.comprobanteKey && (
          <a
            href={`${apiBase}/api/banqueteros/depositos/${d.id}/comprobante`}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="outline" className="px-3 py-1.5 text-xs">
              <FileImage size={13} /> Ficha del banco
            </Button>
          </a>
        )}
        {isAdmin && !d.anuladoAt && (
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-xs text-wine hover:bg-wine/10"
            // Anular el depósito exige que no queden asignaciones vivas: si el
            // dinero ya se repartió, lo que hay que deshacer son los repartos.
            disabled={vivas.length > 0}
            title={
              vivas.length > 0
                ? `Anula primero sus ${vivas.length} asignación(es) viva(s)`
                : undefined
            }
            onClick={() => {
              setAnulando({ tipo: 'deposito', id: d.id });
              setMotivo('');
            }}
          >
            <Ban size={13} /> Anular depósito
          </Button>
        )}
      </div>

      {anulando && (
        <div className="mt-3 space-y-2 rounded-lg border border-wine/30 bg-wine/5 p-3">
          <Field label={anulando.tipo === 'deposito' ? 'Motivo de anular el depósito' : 'Motivo de anular la asignación'}>
            <TextInput
              value={motivo}
              autoFocus
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="ej. iba al evento C, no al B"
            />
          </Field>
          {anulando.tipo === 'asignacion' && (
            <p className="text-xs text-charcoal-soft">
              El monto vuelve al saldo sin asignar y su recibo queda anulado.
            </p>
          )}
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
                setAnulando(null);
                setError('');
              }}
            >
              Cancela
            </Button>
            <Button
              variant="ghost"
              className="bg-wine px-3 py-1.5 text-xs text-cream hover:bg-wine/90"
              disabled={busy || motivo.trim().length < 3}
              onClick={confirmarAnulacion}
            >
              {busy ? 'Anulando…' : 'Sí, anular'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Registrar un depósito a cuenta. Solo admin: es dinero que entra a la hacienda
 * sin destino todavía.
 *
 * Se manda multipart para poder anexar la foto de la ficha del banco desde la
 * tablet, igual que el registro de pagos. La `fecha` es la de RECEPCIÓN, y es la
 * que heredarán los pagos del reparto: el SAT exige facturar el ingreso en el mes
 * en que entró.
 */
function RegistrarDeposito({
  banqueteroId,
  apiBase,
  onCambio,
}: {
  banqueteroId: string;
  apiBase: string;
  onCambio: () => Promise<void>;
}) {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [referencia, setReferencia] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const montoValido = /^\d+$/.test(monto.trim()) && Number(monto) > 0;

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!montoValido) {
      setError('El monto va en pesos enteros, sin centavos.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('monto', monto.trim());
      fd.set('metodo', metodo);
      fd.set('fecha', fecha);
      if (referencia.trim()) fd.set('referencia', referencia.trim());
      if (comprobante) fd.set('comprobante', comprobante);
      const res = await fetch(`${apiBase}/api/banqueteros/${banqueteroId}/depositos`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'No se pudo registrar el depósito.');
      }
      setMonto('');
      setReferencia('');
      setComprobante(null);
      setFileKey((k) => k + 1);
      await onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el depósito.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-fit space-y-4 p-6">
      <h3 className="font-display text-lg text-ink">Registrar depósito</h3>
      <p className="text-xs text-charcoal-soft">
        Entra completo a su cuenta, aunque todavía no se sepa a qué eventos va. El reparto se hace
        después.
      </p>
      <form onSubmit={registrar} className="space-y-3">
        <Field label="Monto (pesos enteros)">
          <MoneyInput value={monto} onValue={setMonto} placeholder="ej. 323,345" />
        </Field>
        <Field label="Forma de pago">
          <SelectInput value={metodo} onChange={(e) => setMetodo(e.target.value as PaymentMethod)}>
            {METODOS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Fecha en que se recibió" hint="Es la fecha fiscal de los pagos del reparto.">
          <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
        <Field label="Referencia (opcional)">
          <TextInput
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="ej. SPEI 0043128"
          />
        </Field>
        <Field label="Ficha del banco (opcional)">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm text-charcoal">
            <Paperclip size={15} />
            <span className="truncate">{comprobante?.name ?? 'Elegir foto o PDF'}</span>
            <input
              key={fileKey}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
            />
          </label>
        </Field>
        {error && (
          <p role="alert" className="text-sm text-wine">
            {error}
          </p>
        )}
        <Button type="submit" variant="gold" disabled={busy}>
          {busy ? 'Guardando…' : 'Registrar depósito'}
        </Button>
      </form>
    </Card>
  );
}
