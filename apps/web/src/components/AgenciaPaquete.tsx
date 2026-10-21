import { useState } from 'react';
import { COMISION_HSA_POR_OMISION } from '@hsa/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UtensilsCrossed } from 'lucide-react';
import { api } from '../lib/api.ts';
import { apiErrorMessage } from './admin/shared.tsx';
import { formatMXN } from '../lib/money.ts';
import { Button, Card, SelectInput, TextInput } from './ui.tsx';
import type { PaqueteDelEvento } from '../lib/types.ts';

/**
 * El paquete de alimentos del evento y la agencia que paga su comisión (BI #4,
 * 15-oct-2026). La agencia se escoge de la lista de banqueteros —nunca texto
 * libre: el BI la cruza por su id— y NO vuelve cliente a la agencia: el contrato
 * sigue a nombre de quien está. Sin escoger, la agencia es el banquetero del
 * evento, si tiene.
 *
 * La comisión de HSA (21-oct-2026): la de la agencia o del cliente profesional
 * (se cambia en su ficha de Clientes); sin ninguno, vive en el evento —el
 * proveedor no siempre se da de alta— y nace en 10%.
 */
export function AgenciaPaquete({
  quoteId,
  paquete,
  agencia,
  banqueteroDelEvento,
  readOnly,
}: {
  quoteId: string;
  paquete: PaqueteDelEvento;
  agencia: { id: string; nombre: string } | null;
  banqueteroDelEvento: { id: string; nombre: string } | null;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const comision = paquete.comision;
  const [pct, setPct] = useState(String(comision?.pct ?? COMISION_HSA_POR_OMISION));
  const pctValido = pct.trim() !== '' && Number(pct) >= 0 && Number(pct) <= 100;

  async function guardarComision() {
    setError('');
    setGuardando(true);
    try {
      await api.patch(`/api/quotes/${quoteId}/comision`, { comisionPct: Number(pct) });
      await qc.invalidateQueries({ queryKey: ['quote', quoteId] });
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo guardar la comisión.'));
    } finally {
      setGuardando(false);
    }
  }
  const { data } = useQuery({
    queryKey: ['banqueteros'],
    queryFn: () => api.get<{ banqueteros: { id: string; nombre: string }[] }>('/api/banqueteros'),
  });
  // Los activos, más la agencia ya puesta aunque se haya dado de baja.
  const opciones = [...(data?.banqueteros ?? [])];
  if (agencia && !opciones.some((b) => b.id === agencia.id)) opciones.unshift({ id: agencia.id, nombre: `${agencia.nombre} (inactiva)` });

  async function cambiar(agenciaId: string) {
    setError('');
    setGuardando(true);
    try {
      await api.patch(`/api/quotes/${quoteId}/agencia`, { agenciaId: agenciaId || null });
      await qc.invalidateQueries({ queryKey: ['quote', quoteId] });
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo cambiar la agencia.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card className="mt-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="inline-flex items-center gap-2 font-display text-xl text-ink">
            <UtensilsCrossed size={18} className="text-gold" /> Paquete de alimentos
          </h3>
          <p className="mt-1 text-sm text-ink">
            <strong className="font-medium">{paquete.nombre}</strong>
            {paquete.comisionMonto != null && (
              <span className="text-charcoal-soft"> · comisión de la agencia {formatMXN(paquete.comisionMonto)}</span>
            )}
          </p>
          {comision && paquete.comisionMonto == null && (
            <div className="mt-3 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-charcoal-soft">Comisión de HSA</p>
              {comision.fuente === 'cliente' ? (
                <p className="mt-1 text-ink">
                  <strong className="font-medium">{comision.pct}%</strong>
                  {comision.monto != null && <span className="text-charcoal-soft"> · {formatMXN(comision.monto)}</span>}
                  <span className="block text-xs text-charcoal-soft">
                    La de {comision.de}; se cambia en su ficha de{' '}
                    <a href="/banqueteros" className="underline">
                      Clientes
                    </a>
                    .
                  </span>
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <TextInput
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={pct}
                    disabled={readOnly || guardando}
                    onChange={(e) => setPct(e.target.value)}
                    aria-label="Comisión de HSA (%)"
                    className="w-24"
                  />
                  <span className="text-charcoal-soft">%</span>
                  {comision.monto != null && <span className="text-charcoal-soft">· {formatMXN(comision.monto)}</span>}
                  {!readOnly && Number(pct) !== comision.pct && (
                    <Button variant="gold" className="px-3 py-1.5 text-xs" disabled={!pctValido || guardando} onClick={() => void guardarComision()}>
                      Guardar
                    </Button>
                  )}
                  <span className="block w-full text-xs text-charcoal-soft">
                    Sin cliente ni agencia dados de alta, la comisión vive en el evento.
                  </span>
                </div>
              )}
            </div>
          )}
          {paquete.origen === 'pactado' && (
            <p className="mt-0.5 text-xs text-charcoal-soft">Viene del BI. El monto de alimentos y servicios sigue siendo el pactado.</p>
          )}
        </div>
        <label className="w-full max-w-xs text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-charcoal-soft">Agencia del paquete</span>
          <SelectInput
            value={agencia?.id ?? ''}
            disabled={readOnly || guardando}
            onChange={(e) => void cambiar(e.target.value)}
          >
            <option value="">
              {banqueteroDelEvento ? `El banquetero del evento (${banqueteroDelEvento.nombre})` : 'Sin agencia'}
            </option>
            {opciones.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
              </option>
            ))}
          </SelectInput>
          <span className="mt-1 block text-xs text-charcoal-soft">
            Quien paga la comisión del paquete. No cambia el cliente ni el contrato. ¿No aparece? Dalo de alta en{' '}
            <a href="/banqueteros" className="underline">
              Clientes
            </a>
            .
          </span>
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-wine">
          {error}
        </p>
      )}
    </Card>
  );
}
