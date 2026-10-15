import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Receipt, ReceiptText } from 'lucide-react';
import { api, API_BASE } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import { describirFormasPago, formatFolio } from '@hsa/shared';
import { Button, Card, Field, TextInput } from './ui.tsx';
import { NotasEditables } from './NotasPago.tsx';
import { RegistrarPagoForm, CONCEPTOS } from './RegistrarPagoForm.tsx';
import { BanquetePagos } from './BanquetePagos.tsx';
import { CorregirPagoForm, MoverPagoForm } from './CorregirPago.tsx';
import type { EstadoCuenta, Payment, PaymentConcept, ActivityEntry, CuentaBanquete } from '../lib/types.ts';
import { ReciboWhatsApp, type ClienteContacto } from './ReciboWhatsApp.tsx';

const CONCEPTO_LABEL: Record<PaymentConcept, string> = {
  anticipo: 'Anticipo',
  // Pagos viejos que todavía digan `complemento`: se leen como a cuenta.
  complemento: 'A cuenta',
  aCuenta: 'A cuenta',
  finiquito: 'Finiquito',
};

interface Props {
  quoteId: string;
  /** Token público de la cotización: con él se arma el enlace al recibo del pago. */
  publicToken: string;
  /** A quién se le manda el recibo por WhatsApp. */
  cliente?: ClienteContacto | null;
  isAdmin: boolean;
  estadoCuenta: EstadoCuenta;
  payments: Payment[];
  /** La cuenta del banquete (alimentos y servicios que cobra la hacienda). */
  banquete?: CuentaBanquete;
  activityLog: ActivityEntry[];
  /** Solo lectura (papelera): sin registrar pagos ni anular. */
  readOnly?: boolean;
  /** Sin registrar pagos nuevos, pero con todo lo demás (evento cancelado). */
  sinPagosNuevos?: boolean;
}

export function PagosPanel({
  quoteId,
  publicToken,
  cliente,
  isAdmin,
  estadoCuenta,
  payments,
  banquete,
  activityLog,
  readOnly = false,
  sinPagosNuevos = false,
}: Props) {
  const qc = useQueryClient();
  const [info, setInfo] = useState('');
  const [pagoAFacturar, setPagoAFacturar] = useState<Payment | null>(null);
  /** El pago que se está corrigiendo o moviendo (uno a la vez). */
  const [accion, setAccion] = useState<{ id: string; tipo: 'corregir' | 'mover' } | null>(null);
  const [uuidFactura, setUuidFactura] = useState('');
  const [errFactura, setErrFactura] = useState('');

  const apiBase = API_BASE;

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['quote', quoteId] });
    // Un pago encola su recibo por correo.
    await qc.invalidateQueries({ queryKey: ['correos', quoteId] });
    await qc.invalidateQueries({ queryKey: ['quotes'] });
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

      {/* Registrar pago de la RENTA y, debajo, del BANQUETE (Jorge, 15-oct-2026):
          dos cuentas separadas, de distinto color para no confundirlas. */}
      {!readOnly && !sinPagosNuevos && (
        <Card className="p-6">
          <RegistrarPagoForm
            quoteId={quoteId}
            isAdmin={isAdmin}
            destino="evento"
            titulo={<>Registrar pago <span className="font-sans text-base font-semibold uppercase tracking-[0.12em] text-gold">Renta</span></>}
            onListo={async (mensaje) => { setInfo(mensaje); await refresh(); }}
          />
        </Card>
      )}
      {banquete && (
        <BanquetePagos
          quoteId={quoteId}
          publicToken={publicToken}
          cliente={cliente}
          isAdmin={isAdmin}
          banquete={banquete}
          puedeRegistrar={!readOnly && !sinPagosNuevos}
          readOnly={readOnly}
          onCambio={async (mensaje) => { if (mensaje) setInfo(mensaje); await refresh(); }}
          onAnular={anular}
        />
      )}

      {/* Lista de pagos */}
      {payments.length > 0 && (
        <Card className="p-6">
          <h3 className="mb-4 font-display text-xl text-ink">Pagos</h3>
          <ul className="divide-y divide-cream-200">
            {payments.map((p) => (
              <li key={p.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm ${p.anuladoAt ? 'opacity-60' : ''}`}>
                <span className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${p.anuladoAt ? 'line-through' : ''}`}>
                  <span className="font-medium text-charcoal-soft">{formatFolio(p.folio, p.folioLetra)}</span> · {formatEventDate(p.fecha)} ·{' '}
                  {/* El concepto es editable en el renglón: corregirlo es un error
                      de captura, no un movimiento de dinero. En los pagos anulados
                      no se toca (son evidencia y el servidor lo rechaza). */}
                  {readOnly || p.anuladoAt ? (
                    <span>{CONCEPTO_LABEL[p.concepto]}</span>
                  ) : (
                    <label className="inline-flex items-center">
                      <span className="sr-only">Concepto del pago {formatFolio(p.folio, p.folioLetra)}</span>
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
                  · {describirFormasPago(p)}
                  {p.referencia && ` · ${p.referencia}`}
                </span>
                <span className="flex items-center gap-3">
                  <span className={`tabular-nums ${p.anuladoAt ? 'line-through' : ''}`}>{formatMXN(p.monto)}</span>
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
                  {!p.anuladoAt && <ReciboWhatsApp cliente={cliente} publicToken={publicToken} pago={p} />}
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
                  {/* Corregir y mover: el mismo recibo, capturado mal. No en un pago
                      facturado (primero se cancela el CFDI) ni en uno que salió de
                      un depósito del banquetero (se corrige desde su cuenta). */}
                  {isAdmin && !readOnly && !p.anuladoAt && !p.facturadoAt && !p.pagoBanqueteroId && (
                    <>
                      <button type="button" onClick={() => setAccion({ id: p.id, tipo: 'corregir' })} className="text-xs text-ink hover:underline">
                        Corregir
                      </button>
                      <button type="button" onClick={() => setAccion({ id: p.id, tipo: 'mover' })} className="text-xs text-ink hover:underline">
                        Mover
                      </button>
                    </>
                  )}
                  {isAdmin && !readOnly && !p.anuladoAt && <button onClick={() => anular(p.id)} className="text-xs text-wine hover:underline">Anular</button>}
                </span>
                {accion?.id === p.id && accion.tipo === 'corregir' && (
                  <CorregirPagoForm
                    quoteId={quoteId}
                    pago={p}
                    onCancelar={() => setAccion(null)}
                    onListo={async () => {
                      setAccion(null);
                      setInfo(`Pago ${formatFolio(p.folio, p.folioLetra)} corregido.`);
                      await refresh();
                    }}
                  />
                )}
                {accion?.id === p.id && accion.tipo === 'mover' && (
                  <MoverPagoForm
                    quoteId={quoteId}
                    pago={p}
                    onCancelar={() => setAccion(null)}
                    onListo={async (destino) => {
                      setAccion(null);
                      setInfo(`Pago ${formatFolio(p.folio, p.folioLetra)} movido al evento ${destino.codigo}.`);
                      await refresh();
                    }}
                  />
                )}
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
                {/* Las notas: lo que ayuda a entender el pago. Se pueden agregar
                    después, incluso en un pago anulado (ahí es donde más falta
                    explicar qué pasó). */}
                <NotasEditables
                  notas={p.notas}
                  editable={!readOnly}
                  onGuardar={async (notas) => {
                    await api.patch(`/api/quotes/${quoteId}/payments/${p.id}/notas`, { notas });
                    await refresh();
                  }}
                />
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
              Pago <strong>{formatFolio(pagoAFacturar.folio, pagoAFacturar.folioLetra)}</strong> de{' '}
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
