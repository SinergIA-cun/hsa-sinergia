import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatFolio } from '@hsa/shared';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Button, Card } from './ui.tsx';
import { apiErrorMessage } from './admin/shared.tsx';
import type { Payment } from '../lib/types.ts';

/** Lo que dice el servidor antes de timbrar: cuánto y a quién. */
interface VistaFactura {
  facturable: boolean;
  motivo: string | null;
  monto: number;
  receptor: { tipo: 'cliente' | 'publicoGeneral'; rfc: string; nombre: string };
  pidioFactura: boolean;
  faltantes: string[];
  pacConfigurado: boolean;
}

interface ResultadoFactura {
  uuid: string;
  correo: string;
}

const CORREO: Record<string, string> = {
  enviado: 'Se le mandó al cliente por correo (XML y PDF).',
  sinCorreo: 'No se mandó por correo (público en general o sin correo del cliente).',
  sinSmtp: 'No se mandó por correo: el correo de salida no está configurado.',
};

/**
 * Facturar un pago con el PAC (30-oct-2026). Antes de timbrar enseña cuánto se
 * factura (sin el efectivo) y a quién: al cliente si pidió factura y tiene sus
 * datos, si no a público en general. "Ya la hice en el PAC" lleva al sello manual.
 */
export function FacturarPagoModal({
  quoteId,
  pago,
  onCerrar,
  onFacturado,
  onManual,
}: {
  quoteId: string;
  pago: Payment;
  onCerrar: () => void;
  onFacturado: () => Promise<void>;
  /** La factura se hizo fuera de la app: sellarla a mano con su UUID. */
  onManual: () => void;
}) {
  const [hecho, setHecho] = useState<ResultadoFactura | null>(null);
  const vista = useQuery({
    queryKey: ['factura', pago.id],
    queryFn: () => api.get<VistaFactura>(`/api/quotes/${quoteId}/payments/${pago.id}/factura`),
  });
  const facturar = useMutation({
    mutationFn: () => api.post<ResultadoFactura>(`/api/quotes/${quoteId}/payments/${pago.id}/facturar`, {}),
    onSuccess: async (r) => {
      setHecho(r);
      await onFacturado();
    },
  });
  const v = vista.data;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-md space-y-4 p-6">
        <h2 className="font-display text-xl text-ink">Facturar pago</h2>
        <p className="text-sm text-charcoal">
          Pago <strong>{formatFolio(pago.folio, pago.folioLetra)}</strong> de <strong>{formatMXN(pago.monto)}</strong> del{' '}
          {formatEventDate(pago.fecha)}.
        </p>

        {vista.isLoading && <p className="text-sm text-charcoal-soft">Revisando el pago…</p>}
        {vista.isError && <p className="text-sm text-wine">{apiErrorMessage(vista.error, 'No se pudo revisar el pago.')}</p>}

        {hecho ? (
          <div className="space-y-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <p>
              Facturado. Folio fiscal <span className="font-mono text-xs">{hecho.uuid}</span>
            </p>
            <p>{CORREO[hecho.correo] ?? `No se pudo mandar por correo: ${hecho.correo.replace(/^error: /, '')}`}</p>
          </div>
        ) : (
          v && (
            <>
              {v.facturable ? (
                <div className="space-y-2 rounded-lg bg-cream-200/70 px-3 py-2 text-sm text-ink">
                  <p>
                    Se factura <strong>{formatMXN(v.monto)}</strong>
                    {v.monto < pago.monto && ' (sin la parte en efectivo)'} a{' '}
                    <strong>{v.receptor.tipo === 'cliente' ? `${v.receptor.nombre} · ${v.receptor.rfc}` : 'público en general'}</strong>.
                  </p>
                  {v.pidioFactura && v.receptor.tipo === 'publicoGeneral' && (
                    <p className="text-wine">
                      El evento pidió factura, pero faltan datos del cliente ({v.faltantes.join(', ')}). Si la quiere a su
                      nombre, complétalos antes de facturar.
                    </p>
                  )}
                </div>
              ) : (
                <p className="rounded-lg bg-cream-200/70 px-3 py-2 text-sm text-ink">{v.motivo}</p>
              )}
              {!v.pacConfigurado && <p className="text-sm text-wine">El PAC no está configurado en el servidor.</p>}
            </>
          )
        )}
        {facturar.isError && <p className="text-sm text-wine">{apiErrorMessage(facturar.error, 'No se pudo facturar.')}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {!hecho ? (
            <button type="button" onClick={onManual} className="text-xs text-charcoal-soft hover:underline" disabled={facturar.isPending}>
              Ya la hice en el PAC
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCerrar} disabled={facturar.isPending}>
              {hecho ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!hecho && (
              <Button
                variant="gold"
                onClick={() => facturar.mutate()}
                disabled={!v?.facturable || !v.pacConfigurado || facturar.isPending}
              >
                {facturar.isPending ? 'Timbrando…' : 'Facturar'}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
