import { useState } from 'react';
import { Receipt, UtensilsCrossed } from 'lucide-react';
import { describirFormasPago, formatFolio } from '@hsa/shared';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Card } from './ui.tsx';
import { RegistrarPagoForm } from './RegistrarPagoForm.tsx';
import { ReciboWhatsApp, type ClienteContacto } from './ReciboWhatsApp.tsx';
import { MoverPagoForm } from './CorregirPago.tsx';
import type { CuentaBanquete, PaymentConcept } from '../lib/types.ts';

const CONCEPTO: Record<PaymentConcept, string> = {
  anticipo: 'Anticipo',
  complemento: 'A cuenta',
  aCuenta: 'A cuenta',
  finiquito: 'Finiquito',
};

/**
 * El banquete del evento: lo que la hacienda cobra de "Alimentos y otros
 * servicios" del contrato, aparte de la renta (Jorge, 15-oct-2026).
 *
 * Va en verde y no en el blanco de la renta a propósito: son dos cuentas con su
 * propio saldo, y un pago capturado en la equivocada se nota a simple vista.
 */
export function BanquetePagos({
  quoteId,
  publicToken,
  cliente,
  isAdmin,
  banquete,
  puedeRegistrar,
  readOnly,
  onCambio,
  onAnular,
}: {
  quoteId: string;
  publicToken: string;
  cliente?: ClienteContacto | null;
  isAdmin: boolean;
  banquete: CuentaBanquete;
  puedeRegistrar: boolean;
  readOnly: boolean;
  onCambio: (mensaje?: string) => Promise<void>;
  onAnular: (paymentId: string) => Promise<void>;
}) {
  const [reasignando, setReasignando] = useState<string | null>(null);
  const sinBanquete = banquete.total <= 0;
  const saldado = !sinBanquete && banquete.saldo <= 0;

  const resumen = (
    <div className="grid grid-cols-3 gap-3 rounded-lg bg-white/60 px-3 py-2 text-center">
      <Dato etiqueta="Total banquete">{formatMXN(banquete.total)}</Dato>
      <Dato etiqueta="Pagado">{formatMXN(banquete.pagado)}</Dato>
      <Dato etiqueta="Saldo" resaltar>{formatMXN(banquete.saldo)}</Dato>
    </div>
  );

  const titulo = (
    <span className="inline-flex items-center gap-2">
      <UtensilsCrossed size={18} className="text-emerald-700" />
      Registrar pago <span className="font-sans text-base font-semibold uppercase tracking-[0.12em] text-emerald-700">Banquete</span>
    </span>
  );

  return (
    <Card className="border-emerald-200 bg-emerald-50/70 p-6">
      {puedeRegistrar && !sinBanquete && !saldado ? (
        <RegistrarPagoForm
          quoteId={quoteId}
          isAdmin={isAdmin}
          destino="banquete"
          titulo={titulo}
          pie={
            <div className="space-y-2">
              <p className="text-sm text-charcoal-soft">
                Alimentos y otros servicios del contrato. No cambia la renta ni el plan de pagos.
              </p>
              {resumen}
            </div>
          }
          onListo={(mensaje) => onCambio(mensaje)}
        />
      ) : (
        <>
          <h3 className="mb-1 font-display text-xl text-ink">{titulo}</h3>
          <p className="mb-3 text-sm text-charcoal-soft">
            {sinBanquete
              ? 'Este evento no tiene alimentos ni servicios contratados: no hay banquete que cobrar.'
              : saldado
                ? 'El banquete está pagado completo.'
                : 'Alimentos y otros servicios del contrato.'}
          </p>
          {!sinBanquete && resumen}
        </>
      )}

      {banquete.pagos.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">Pagos del banquete</h4>
          <ul className="divide-y divide-emerald-200/70 text-sm">
            {banquete.pagos.map((p) => (
              <li
                key={p.id}
                className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 ${p.anuladoAt ? 'opacity-60' : ''}`}
              >
                <span className={p.anuladoAt ? 'line-through' : ''}>
                  <span className="font-medium text-charcoal-soft">{formatFolio(p.folio, p.folioLetra)}</span> ·{' '}
                  {formatEventDate(p.fecha)} · {CONCEPTO[p.concepto]} · {describirFormasPago(p)}
                  {p.referencia && ` · ${p.referencia}`}
                </span>
                <span className="flex items-center gap-3">
                  <span className={`tabular-nums ${p.anuladoAt ? 'line-through' : ''}`}>{formatMXN(p.monto)}</span>
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
                  {isAdmin && !readOnly && !p.anuladoAt && (
                    <button type="button" onClick={() => onAnular(p.id)} className="text-xs text-wine hover:underline">
                      Anular
                    </button>
                  )}
                  {isAdmin && !readOnly && p.anuladoAt && !p.facturadoAt && !p.pagoBanqueteroId && (
                    <button type="button" onClick={() => setReasignando(p.id)} className="text-xs text-ink hover:underline">
                      Reasignar a otro evento
                    </button>
                  )}
                </span>
                {reasignando === p.id && (
                  <MoverPagoForm
                    quoteId={quoteId}
                    pago={p}
                    onCancelar={() => setReasignando(null)}
                    onListo={async (destino) => {
                      setReasignando(null);
                      await onCambio(`Pago ${formatFolio(p.folio, p.folioLetra)} reasignado al evento ${destino.codigo}.`);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Dato({ etiqueta, resaltar, children }: { etiqueta: string; resaltar?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.7rem] uppercase tracking-wide text-charcoal-soft">{etiqueta}</p>
      <p className={`font-display text-lg ${resaltar ? 'text-emerald-800' : 'text-ink'}`}>{children}</p>
    </div>
  );
}
