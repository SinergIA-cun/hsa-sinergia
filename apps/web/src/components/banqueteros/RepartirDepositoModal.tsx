import { useMemo, useState } from 'react';
import { AlertTriangle, Coins } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Card, MoneyInput } from '../ui.tsx';
import { apiErrorMessage } from '../admin/shared.tsx';
import { STATUS_LABEL } from '../../lib/status.ts';
import type { DepositoBanquetero, EventoBanquetero } from '../../lib/types.ts';

interface Props {
  deposito: DepositoBanquetero;
  eventos: EventoBanquetero[];
  onCancel: () => void;
  /** Se llama después de guardar, con los pagos que nacieron del reparto. */
  onSaved: (pagos: PagoCreado[]) => Promise<void>;
}

export interface PagoCreado {
  quoteId: string;
  paymentId: string;
  folio: number;
  monto: number;
  concepto: string;
}

/**
 * El reparto de un depósito: el caso 2 del dueño hecho pantalla.
 *
 * "Puede hacer un pago por 323,345 pesos y luego decirte cómo van distribuidos:
 * 55,000 a evento A, 55,000 a evento B, el resto a evento C." Por eso el
 * remanente se calcula en vivo y hay un botón "el resto" por renglón: así se
 * teclea la instrucción tal como llega por teléfono, sin sacar la calculadora.
 *
 * Se manda UNA sola petición con todo el reparto. El servidor valida el total
 * antes de escribir nada, así que un reparto que se pasa del saldo no deja dos
 * pagos hechos y el tercero rechazado.
 */
export function RepartirDepositoModal({ deposito, eventos, onCancel, onSaved }: Props) {
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /**
   * Un monto capturado tiene que ser un entero: la columna es `Int` y Prisma
   * TRUNCA los flotantes del lado del cliente sin avisar (55000.9 → 55000). Un
   * decimal se rechaza aquí y también en el servidor; nunca se redondea.
   */
  function parseMonto(v: string): number | null {
    const s = v.trim();
    if (s === '') return 0;
    if (!/^\d+$/.test(s)) return null;
    return Number(s);
  }

  const renglones = useMemo(
    () => eventos.map((e) => ({ evento: e, raw: montos[e.quoteId] ?? '', monto: parseMonto(montos[e.quoteId] ?? '') })),
    [eventos, montos],
  );

  const invalido = renglones.some((r) => r.monto == null);
  const pedido = renglones.reduce((s, r) => s + (r.monto ?? 0), 0);
  const remanente = deposito.saldoSinAsignar - pedido;
  const conMonto = renglones.filter((r) => (r.monto ?? 0) > 0);
  const puedeGuardar = !invalido && conMonto.length > 0 && remanente >= 0 && !busy;

  /** Vuelca todo el remanente en este renglón: "el resto al evento C". */
  function elResto(quoteId: string) {
    const actual = parseMonto(montos[quoteId] ?? '') ?? 0;
    setMontos((m) => ({ ...m, [quoteId]: String(actual + Math.max(0, remanente)) }));
  }

  async function guardar() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ pagos: PagoCreado[] }>(
        `/api/banqueteros/depositos/${deposito.id}/asignaciones`,
        { asignaciones: conMonto.map((r) => ({ quoteId: r.evento.quoteId, monto: r.monto })) },
      );
      await onSaved(res.pagos);
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo repartir el depósito.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/40 px-4 py-8" role="dialog" aria-modal="true" aria-label="Repartir depósito">
      <Card className="w-full max-w-2xl space-y-5 p-6">
        <div>
          <h2 className="font-display text-2xl text-ink">Repartir el depósito</h2>
          <p className="mt-1 text-sm text-charcoal-soft">
            Depósito de <strong className="text-ink">{formatMXN(deposito.monto)}</strong> recibido el{' '}
            {formatEventDate(deposito.fecha)} ({deposito.metodo}
            {deposito.referencia ? ` · ${deposito.referencia}` : ''}). Cada renglón crea un pago con
            su folio de recibo, <strong>con la fecha del depósito</strong>.
          </p>
        </div>

        {eventos.length === 0 ? (
          <p className="rounded-lg border border-wine/30 bg-wine/5 px-3 py-2.5 text-sm text-wine">
            Este banquetero no tiene eventos a los que repartir. Primero hay que cotizarle uno o
            convertir un apartado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cream-300 text-left text-xs uppercase tracking-wide text-charcoal-soft">
                  <th className="py-2 pr-3 font-semibold">Evento</th>
                  <th className="py-2 pr-3 text-right font-semibold">Saldo</th>
                  <th className="py-2 pr-3 text-right font-semibold">Se le asigna</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-200">
                {renglones.map(({ evento: e, raw, monto }) => {
                  const excede = monto != null && monto > e.saldo;
                  return (
                    <tr key={e.quoteId}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium text-ink">
                          {e.codigo ?? e.festejado ?? 'Evento'}
                        </span>
                        <span className="block text-xs text-charcoal-soft">
                          {formatEventDate(e.fechaEventoISO)} · {STATUS_LABEL[e.status]}
                          {e.festejado && e.codigo ? ` · ${e.festejado}` : ''}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-charcoal">
                        {formatMXN(e.saldo)}
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        <MoneyInput
                          aria-label={`Monto para ${e.codigo ?? e.festejado ?? 'el evento'}`}
                          value={raw}
                          onValue={(v) => setMontos((m) => ({ ...m, [e.quoteId]: v }))}
                          placeholder="0"
                          className={`w-28 text-right ${monto == null ? 'border-wine' : ''}`}
                        />
                        {monto == null && (
                          <span className="mt-1 block text-[0.7rem] text-wine">Pesos enteros</span>
                        )}
                        {excede && (
                          <span className="mt-1 block text-[0.7rem] text-amber-700">
                            Rebasa su saldo
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          disabled={remanente <= 0}
                          onClick={() => elResto(e.quoteId)}
                        >
                          El resto
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* El remanente EN VIVO. Es el número que decide si se puede guardar. */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 ${
            remanente < 0 ? 'bg-wine/10 text-wine' : remanente === 0 ? 'bg-ink text-cream' : 'bg-gold/15 text-ink'
          }`}
        >
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <Coins size={16} /> Remanente sin asignar
          </span>
          <span className="font-display text-2xl tabular-nums" aria-live="polite">
            {formatMXN(remanente)}
          </span>
        </div>

        {remanente < 0 && (
          <p className="flex items-start gap-2 text-sm text-wine">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            El reparto se pasa {formatMXN(-remanente)} del saldo sin asignar de este depósito.
          </p>
        )}
        {remanente > 0 && conMonto.length > 0 && (
          <p className="text-xs text-charcoal-soft">
            Se puede guardar con remanente: quedan {formatMXN(remanente)} en la cuenta del
            banquetero, sin destino, y se reparten después.
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-wine">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="gold" onClick={guardar} disabled={!puedeGuardar}>
            {busy ? 'Repartiendo…' : `Crear ${conMonto.length} pago(s)`}
          </Button>
        </div>
      </Card>
    </div>
  );
}
