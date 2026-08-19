import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Receipt, ReceiptText } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import { Button, Card, TextInput, SelectInput, Field } from './ui.tsx';
import { STATUS_LABEL } from '../lib/status.ts';
import type { EstadoCuenta, Payment, PaymentConcept, ActivityEntry, QuoteStatus } from '../lib/types.ts';

/** Los cuatro conceptos, con la etiqueta que ve la vendedora. */
const CONCEPTOS: { value: PaymentConcept; label: string }[] = [
  { value: 'anticipo', label: 'Anticipo' },
  { value: 'complemento', label: 'Complemento' },
  { value: 'aCuenta', label: 'A cuenta' },
  { value: 'finiquito', label: 'Finiquito' },
];

const CONCEPTO_LABEL: Record<PaymentConcept, string> = {
  anticipo: 'Anticipo',
  complemento: 'Complemento',
  aCuenta: 'A cuenta',
  finiquito: 'Finiquito',
};

interface Props {
  quoteId: string;
  /** Token público de la cotización: con él se arma el enlace al recibo del pago. */
  publicToken: string;
  isAdmin: boolean;
  estadoCuenta: EstadoCuenta;
  payments: Payment[];
  activityLog: ActivityEntry[];
  /** Solo lectura (papelera): sin registrar pagos ni anular. */
  readOnly?: boolean;
}

export function PagosPanel({ quoteId, publicToken, isAdmin, estadoCuenta, payments, activityLog, readOnly = false }: Props) {
  const qc = useQueryClient();
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('transferencia');
  const [concepto, setConcepto] = useState('anticipo');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [referencia, setReferencia] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pagoAFacturar, setPagoAFacturar] = useState<Payment | null>(null);
  const [uuidFactura, setUuidFactura] = useState('');
  const [errFactura, setErrFactura] = useState('');

  const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['quote', quoteId] });
    await qc.invalidateQueries({ queryKey: ['quotes'] });
  }

  // Se envía multipart (FormData) para poder anexar la foto de comprobante
  // (cámara en tablet o archivo). El backend acepta multipart y JSON.
  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('monto', monto);
      fd.set('metodo', metodo);
      fd.set('concepto', concepto);
      fd.set('fecha', fecha);
      if (referencia) fd.set('referencia', referencia);
      if (comprobante) fd.set('comprobante', comprobante);

      const res = await fetch(`${apiBase}/api/quotes/${quoteId}/payments`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { nuevoEstatus: QuoteStatus | null };

      setMonto(''); setReferencia(''); setComprobante(null); setFileKey((k) => k + 1);
      setInfo(body.nuevoEstatus ? `Estatus actualizado automáticamente a ${STATUS_LABEL[body.nuevoEstatus]}.` : '');
      await refresh();
    } catch {
      setErr('No se pudo registrar el pago. Revisa los datos.');
    } finally {
      setBusy(false);
    }
  }

  // Reabrir la facturación de un pago cuyo mes ya cerró. Solo admin, y queda en
  // la bitácora: por eso el candado puede ser estricto, la salida es visible.
  const desbloquear = useMutation({
    mutationFn: (paymentId: string) =>
      api.patch(`/api/quotes/${quoteId}/payments/${paymentId}/desbloquear-factura`, {}),
    onSuccess: refresh,
  });

  // Sellar el pago como facturado. Sin PAC conectado este es el único disparador
  // del candado de datos fiscales, así que es una acción manual de admin.
  const marcarFacturado = useMutation({
    mutationFn: ({ paymentId, uuid }: { paymentId: string; uuid: string }) =>
      api.post(`/api/quotes/${quoteId}/payments/${paymentId}/facturado`, {
        facturaUuid: uuid.trim() || null,
      }),
    onSuccess: async () => {
      setPagoAFacturar(null);
      setUuidFactura('');
      setErrFactura('');
      await refresh();
    },
    onError: () => setErrFactura('No se pudo sellar. Revisa que el folio fiscal sea un UUID válido.'),
  });

  async function anular(paymentId: string) {
    const motivo = window.prompt('Motivo de la anulación:');
    if (!motivo) return;
    await api.patch(`/api/quotes/${quoteId}/payments/${paymentId}/anular`, { motivo });
    await refresh();
  }

  // Corregir el concepto de un pago. Lo puede hacer ventas sobre lo suyo: es un
  // error de captura, no un movimiento de dinero. El servidor reaplica la regla
  // del finiquito, así que el concepto que quede puede no ser el que se pidió —
  // por eso siempre se recarga en vez de pintar lo elegido.
  const corregirConcepto = useMutation({
    mutationFn: ({ paymentId, concepto }: { paymentId: string; concepto: string }) =>
      api.patch(`/api/quotes/${quoteId}/payments/${paymentId}/concepto`, { concepto }),
    onSuccess: refresh,
  });

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

      {info && (
        <Card className="border-gold/40 bg-gold/5 p-4">
          <p className="text-sm text-ink">{info}</p>
        </Card>
      )}

      {/* Registrar pago */}
      {!readOnly && (
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
          {/* El concepto se DEDUCE del saldo: comparando el pagado acumulado con
              los hitos del plan sale solo si es anticipo, complemento, a cuenta o
              finiquito. Lo que se elige aquí solo se usa en los eventos SIN plan
              de pagos (los espacios cuyos montos no están definidos). Si hace
              falta discrepar, el concepto se corrige en el renglón del pago. */}
          <Field
            label="Concepto"
            hint="Se deduce del saldo. Solo se usa tal cual si el evento no tiene plan de pagos."
          >
            <SelectInput value={concepto} onChange={(e) => setConcepto(e.target.value)}>
              {CONCEPTOS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Referencia (opcional)"><TextInput value={referencia} onChange={(e) => setReferencia(e.target.value)} /></Field>
          <Field label="Comprobante (foto, opcional)" hint="En tablet abre la cámara.">
            <input
              key={fileKey}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-charcoal file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:text-cream hover:file:bg-ink-700"
            />
          </Field>
          <div className="sm:col-span-2">
            {err && <p className="mb-2 text-sm text-wine">{err}</p>}
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar pago'}</Button>
          </div>
        </form>
      </Card>
      )}

      {/* Lista de pagos */}
      {payments.length > 0 && (
        <Card className="p-6">
          <h3 className="mb-4 font-display text-xl text-ink">Pagos</h3>
          <ul className="divide-y divide-cream-200">
            {payments.map((p) => (
              <li key={p.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm ${p.anuladoAt ? 'opacity-50 line-through' : ''}`}>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="text-charcoal-soft/70">#{p.folio}</span> · {formatEventDate(p.fecha)} ·{' '}
                  {/* El concepto es editable en el renglón: corregirlo es un error
                      de captura, no un movimiento de dinero. En los pagos anulados
                      no se toca (son evidencia y el servidor lo rechaza). */}
                  {readOnly || p.anuladoAt ? (
                    <span>{CONCEPTO_LABEL[p.concepto]}</span>
                  ) : (
                    <label className="inline-flex items-center">
                      <span className="sr-only">Concepto del pago #{p.folio}</span>
                      <select
                        value={p.concepto}
                        onChange={(e) => corregirConcepto.mutate({ paymentId: p.id, concepto: e.target.value })}
                        disabled={corregirConcepto.isPending}
                        className="rounded border border-ink/15 bg-transparent px-1 py-0.5 text-sm text-ink disabled:opacity-50"
                      >
                        {CONCEPTOS.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  · {p.metodo}
                  {p.referencia && ` · ${p.referencia}`}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMXN(p.monto)}</span>
                  {p.comprobanteKey && !p.anuladoAt && (
                    <a
                      href={`${apiBase}/api/quotes/${quoteId}/comprobante/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-gold hover:underline"
                    >
                      Ver comprobante
                    </a>
                  )}
                  {/* El recibo imprimible del pago. Ya existía para el cliente
                      (cuelga de su token); esto es el enlace que le faltaba a la
                      vendedora, que tiene ese token a mano.

                      En los pagos ANULADOS no se muestra: un recibo de un pago
                      anulado circulando es un problema. El servidor tampoco lo
                      sirve —`getByToken` filtra los anulados—, así que el enlace
                      solo llevaría a "Recibo no encontrado". */}
                  {!p.anuladoAt && (
                    <a
                      href={`/c/${publicToken}/recibo/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline"
                    >
                      <Receipt size={12} /> Ver recibo
                    </a>
                  )}
                  {p.facturadoAt && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                      title={p.facturaUuid ? `Folio fiscal ${p.facturaUuid}` : 'Sin folio fiscal capturado'}
                    >
                      <ReceiptText size={12} /> Facturado
                    </span>
                  )}
                  {isAdmin && !readOnly && !p.anuladoAt && !p.facturadoAt && (
                    <button
                      type="button"
                      onClick={() => { setPagoAFacturar(p); setUuidFactura(''); setErrFactura(''); }}
                      className="text-xs text-ink hover:underline"
                    >
                      Marcar facturado
                    </button>
                  )}
                  {isAdmin && !readOnly && !p.anuladoAt && <button onClick={() => anular(p.id)} className="text-xs text-wine hover:underline">Anular</button>}
                </span>
                {/* Si el deducido difiere del capturado, se muestra el deducido
                    (arriba, en el selector) y se dice por qué. Es el caso que el
                    dueño pidió: "debe moverse a finiquito solo, si ya fue el pago
                    que finiquitó, sin importar cómo pusieron el campo." */}
                {p.conceptoManual && p.conceptoManual !== p.concepto && !p.anuladoAt && (
                  <p className="w-full text-xs text-charcoal-soft">
                    Se capturó <strong>{CONCEPTO_LABEL[p.conceptoManual]}</strong>, pero el saldo dice{' '}
                    <strong>{CONCEPTO_LABEL[p.concepto]}</strong>
                    {p.concepto === 'finiquito'
                      ? ': este pago es el que finiquitó la renta.'
                      : ': este pago no finiquita la renta, así que no puede ir como finiquito.'}
                  </p>
                )}
                {p.facturable === false && !p.anuladoAt && !p.facturadoAt && (
                  <div className="flex w-full flex-wrap items-center gap-2 text-xs text-charcoal-soft">
                    <span className="inline-flex items-center gap-1">
                      <Lock size={12} /> {p.motivoFactura}
                    </span>
                    {isAdmin && !readOnly && (
                      <button
                        type="button"
                        onClick={() => desbloquear.mutate(p.id)}
                        disabled={desbloquear.isPending}
                        className="rounded border border-ink/15 px-2 py-0.5 text-xs text-ink hover:bg-ink/5 disabled:opacity-50"
                      >
                        Reabrir facturación
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Sellar un pago como facturado */}
      {pagoAFacturar && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md space-y-4 p-6">
            <h2 className="font-display text-xl text-ink">Marcar pago como facturado</h2>
            <p className="text-sm text-charcoal">
              Pago <strong>#{pagoAFacturar.folio}</strong> de{' '}
              <strong>{formatMXN(pagoAFacturar.monto)}</strong> del {formatEventDate(pagoAFacturar.fecha)}.
            </p>
            <p className="rounded-lg bg-cream-200/70 px-3 py-2 text-sm text-ink">
              A partir de aquí los datos fiscales del cliente quedan congelados: solo un
              administrador podrá cambiarlos, y el cambio quedará en la bitácora.
            </p>
            <Field label="Folio fiscal (UUID)" hint="Opcional. Puedes capturarlo después si aún no lo tienes.">
              <TextInput
                value={uuidFactura}
                onChange={(e) => setUuidFactura(e.target.value)}
                placeholder="11111111-2222-3333-4444-555555555555"
              />
            </Field>
            {errFactura && <p className="text-sm text-wine">{errFactura}</p>}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setPagoAFacturar(null)}
                disabled={marcarFacturado.isPending}
              >
                Cancelar
              </Button>
              <Button
                variant="gold"
                onClick={() => marcarFacturado.mutate({ paymentId: pagoAFacturar.id, uuid: uuidFactura })}
                disabled={marcarFacturado.isPending}
              >
                {marcarFacturado.isPending ? 'Sellando…' : 'Marcar facturado'}
              </Button>
            </div>
          </Card>
        </div>
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
