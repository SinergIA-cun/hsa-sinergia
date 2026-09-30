import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { describirFormasPago } from '@hsa/shared';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Button, Card } from './ui.tsx';
import { DevolucionForm } from './DevolucionForm.tsx';
import { apiErrorMessage } from './admin/shared.tsx';
import type { Devolucion } from '../lib/types.ts';

/** Las devoluciones ya registradas, con anular y anotar la nota de crédito (admin). */
export function ListaDevoluciones({
  devoluciones,
  isAdmin,
  onCambio,
}: {
  devoluciones: Devolucion[];
  isAdmin: boolean;
  onCambio: () => Promise<void>;
}) {
  async function anular(id: string) {
    const motivo = window.prompt('Motivo de la anulación de la devolución:');
    if (!motivo) return;
    try {
      await api.patch(`/api/devoluciones/${id}/anular`, { motivo });
      await onCambio();
    } catch (e) {
      window.alert(apiErrorMessage(e, 'No se pudo anular la devolución.'));
    }
  }
  async function notaCredito(id: string) {
    const uuid = window.prompt('UUID de la nota de crédito:');
    if (!uuid) return;
    try {
      await api.patch(`/api/devoluciones/${id}/nota-credito`, { notaCreditoUuid: uuid.trim() });
      await onCambio();
    } catch (e) {
      window.alert(apiErrorMessage(e, 'No se pudo anotar la nota de crédito. Revisa que sea un UUID válido.'));
    }
  }
  return (
    <ul className="divide-y divide-cream-200 text-sm">
      {devoluciones.map((d) => (
        <li key={d.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${d.anuladoAt ? 'opacity-50 line-through' : ''}`}>
          <span>
            {formatEventDate(d.fecha)} · {describirFormasPago(d)}
            {d.destino === 'cargos' && ' · de la cuenta del evento'}
            {d.pagoBanquetero && ` · del depósito ${d.pagoBanquetero.folio != null ? `I ${d.pagoBanquetero.folio}` : ''}`}
            <span className="block text-xs text-charcoal-soft">
              {d.motivo}
              {d.notaCreditoUuid && ` · Nota de crédito ${d.notaCreditoUuid}`}
              {d.anuladoAt && d.motivoAnulacion && ` · Anulada: ${d.motivoAnulacion}`}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <span className="tabular-nums text-wine">−{formatMXN(d.monto)}</span>
            {isAdmin && !d.anuladoAt && !d.notaCreditoUuid && (
              <button type="button" onClick={() => notaCredito(d.id)} className="text-xs text-ink hover:underline">
                Nota de crédito
              </button>
            )}
            {isAdmin && !d.anuladoAt && (
              <button type="button" onClick={() => anular(d.id)} className="text-xs text-wine hover:underline">
                Anular
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Devoluciones del cliente de un evento. Se ofrece cuando ya entró dinero; si el
 * cliente pagó de más, el monto arranca con el excedente.
 */
export function DevolucionesEvento({
  quoteId,
  isAdmin,
  pagadoRenta,
  saldoRenta,
  pagadoCuenta,
  devoluciones,
  readOnly = false,
}: {
  quoteId: string;
  isAdmin: boolean;
  pagadoRenta: number;
  /** Negativo = pagó de más. */
  saldoRenta: number;
  pagadoCuenta: number;
  devoluciones: Devolucion[];
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: ['quote', quoteId] });
  };
  const excedente = saldoRenta < 0 ? -saldoRenta : 0;
  const puedeDevolver = isAdmin && !readOnly && pagadoRenta + pagadoCuenta > 0;
  if (!puedeDevolver && devoluciones.length === 0) return null;

  return (
    <Card className="mt-8 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-xl text-ink">
          <Undo2 size={18} className="text-wine" /> Devoluciones
        </h3>
        {puedeDevolver && !abierto && (
          <Button variant="outline" onClick={() => setAbierto(true)}>
            Registrar devolución
          </Button>
        )}
      </div>
      {excedente > 0 && (
        <p className="mt-2 rounded-lg bg-wine/10 px-3 py-2 text-sm text-wine">
          El cliente pagó <strong>{formatMXN(excedente)}</strong> de más en la renta.
        </p>
      )}
      {abierto && (
        <DevolucionForm
          sugerido={excedente}
          maximo={pagadoRenta}
          destinos={[
            { valor: 'evento', etiqueta: 'La renta', maximo: pagadoRenta },
            ...(pagadoCuenta > 0 ? [{ valor: 'cargos', etiqueta: 'La cuenta del evento', maximo: pagadoCuenta }] : []),
          ]}
          onEnviar={async (cuerpo) => {
            await api.post(`/api/quotes/${quoteId}/devoluciones`, cuerpo);
            await refrescar();
          }}
          onCerrar={() => setAbierto(false)}
        />
      )}
      {devoluciones.length > 0 && (
        <div className="mt-4">
          <ListaDevoluciones devoluciones={devoluciones} isAdmin={isAdmin && !readOnly} onCambio={refrescar} />
        </div>
      )}
    </Card>
  );
}
