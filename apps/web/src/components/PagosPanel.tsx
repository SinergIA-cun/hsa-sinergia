import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import { Button, Card, TextInput, SelectInput, Field } from './ui.tsx';
import { STATUS_LABEL } from '../lib/status.ts';
import type { EstadoCuenta, Payment, ActivityEntry, QuoteStatus } from '../lib/types.ts';

interface Props {
  quoteId: string;
  isAdmin: boolean;
  estadoCuenta: EstadoCuenta;
  payments: Payment[];
  activityLog: ActivityEntry[];
}

export function PagosPanel({ quoteId, isAdmin, estadoCuenta, payments, activityLog }: Props) {
  const qc = useQueryClient();
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('transferencia');
  const [concepto, setConcepto] = useState('anticipo');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [referencia, setReferencia] = useState('');
  const [sugerido, setSugerido] = useState<QuoteStatus | null>(null);
  const [err, setErr] = useState('');

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['quote', quoteId] });
    await qc.invalidateQueries({ queryKey: ['quotes'] });
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const res = await api.post<{ sugerenciaUpgrade: QuoteStatus | null }>(
        `/api/quotes/${quoteId}/payments`,
        {
          monto: Number(monto),
          metodo, concepto, fecha,
          referencia: referencia || undefined,
        },
      );
      setMonto(''); setReferencia('');
      setSugerido(res.sugerenciaUpgrade);
      await refresh();
    } catch {
      setErr('No se pudo registrar el pago. Revisa los datos.');
    }
  }

  async function avanzar() {
    if (!sugerido) return;
    await api.patch(`/api/quotes/${quoteId}/status`, { status: sugerido });
    setSugerido(null);
    await refresh();
  }

  async function anular(paymentId: string) {
    const motivo = window.prompt('Motivo de la anulación:');
    if (!motivo) return;
    await api.patch(`/api/quotes/${quoteId}/payments/${paymentId}/anular`, { motivo });
    await refresh();
  }

  return (
    <div className="mt-8 grid gap-6">
      {/* Estado de cuenta */}
      <Card className="p-6">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><p className="text-xs uppercase tracking-wide text-charcoal-soft">Total</p><p className="font-display text-2xl text-ink">{formatMXN(estadoCuenta.total)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-charcoal-soft">Pagado</p><p className="font-display text-2xl text-ink">{formatMXN(estadoCuenta.pagado)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-charcoal-soft">Saldo</p><p className="font-display text-2xl text-gold">{formatMXN(estadoCuenta.saldo)}</p></div>
        </div>
        {estadoCuenta.desfase && (
          <p className="mt-4 rounded-lg bg-wine/10 px-3 py-2 text-sm text-wine">
            Aviso: el acumulado ya no cubre el hito de este estatus. Revisa si corresponde ajustar el estatus.
          </p>
        )}
        {estadoCuenta.planPendiente ? (
          <p className="mt-4 text-sm text-charcoal-soft">Plan de pagos pendiente de configurar para este espacio.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {estadoCuenta.plan?.map((m) => (
              <li key={m.key} className="flex items-center justify-between text-sm">
                <span className={m.completo ? 'text-ink' : 'text-charcoal-soft'}>
                  {m.completo ? '✓' : '○'} {m.label} {m.venceISO && <span className="text-xs text-charcoal-soft/70">· vence {formatEventDate(m.venceISO)}</span>}
                </span>
                <span className="tabular-nums">{formatMXN(m.cubierto)} / {formatMXN(m.objetivo)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sugerido && (
        <Card className="flex items-center justify-between gap-4 border-gold/40 p-4">
          <p className="text-sm text-ink">El pago alcanza el hito. ¿Marcar como <strong>{STATUS_LABEL[sugerido]}</strong>?</p>
          <div className="flex gap-2">
            <Button variant="gold" onClick={avanzar}>Sí, avanzar</Button>
            <Button variant="ghost" onClick={() => setSugerido(null)}>Ahora no</Button>
          </div>
        </Card>
      )}

      {/* Registrar pago */}
      <Card className="p-6">
        <h3 className="mb-4 font-display text-xl text-ink">Registrar pago</h3>
        <form onSubmit={registrar} className="grid gap-4 sm:grid-cols-2">
          <Field label="Monto (MXN)"><TextInput type="number" min="1" value={monto} onChange={(e) => setMonto(e.target.value)} required /></Field>
          <Field label="Fecha"><TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></Field>
          <Field label="Método">
            <SelectInput value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              <option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option>
            </SelectInput>
          </Field>
          <Field label="Concepto">
            <SelectInput value={concepto} onChange={(e) => setConcepto(e.target.value)}>
              <option value="anticipo">Anticipo</option><option value="complemento">Complemento</option><option value="aCuenta">A cuenta</option><option value="finiquito">Finiquito</option>
            </SelectInput>
          </Field>
          <Field label="Referencia (opcional)"><TextInput value={referencia} onChange={(e) => setReferencia(e.target.value)} /></Field>
          <div className="sm:col-span-2">
            {err && <p className="mb-2 text-sm text-wine">{err}</p>}
            <Button type="submit" variant="primary">Guardar pago</Button>
          </div>
        </form>
      </Card>

      {/* Lista de pagos */}
      {payments.length > 0 && (
        <Card className="p-6">
          <h3 className="mb-4 font-display text-xl text-ink">Pagos</h3>
          <ul className="divide-y divide-cream-200">
            {payments.map((p) => (
              <li key={p.id} className={`flex items-center justify-between gap-4 py-2.5 text-sm ${p.anuladoAt ? 'opacity-50 line-through' : ''}`}>
                <span>{formatEventDate(p.fecha)} · {p.concepto} · {p.metodo}{p.referencia && ` · ${p.referencia}`}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMXN(p.monto)}</span>
                  {isAdmin && !p.anuladoAt && <button onClick={() => anular(p.id)} className="text-xs text-wine hover:underline">Anular</button>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Bitácora */}
      {activityLog.length > 0 && (
        <Card className="p-6">
          <h3 className="mb-4 font-display text-xl text-ink">Bitácora</h3>
          <ul className="space-y-2 text-sm">
            {activityLog.map((a) => (
              <li key={a.id} className="flex justify-between gap-4 text-charcoal-soft">
                <span>{a.descripcion}{a.actor?.nombre && ` — ${a.actor.nombre}`}</span>
                <span className="text-xs text-charcoal-soft/70">{formatTimestamp(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
