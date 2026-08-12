import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.ts';
import { usePriceLists } from '../lib/catalogos.ts';
import { formatMXN } from '../lib/money.ts';
import { Button, Card, Field, SelectInput } from './ui.tsx';
import { apiErrorMessage } from './admin/shared.tsx';

interface Props {
  quoteId: string;
  /** Catálogo al que la cotización está casada hoy. */
  catalogoActual: { id: string; nombre: string } | null;
  totalActual: number;
  /** Lo ya pagado: si el total nuevo queda por debajo, el evento entra en desfase. */
  pagado: number;
  onClose: () => void;
  /** Se llama tras mover, para invalidar lo que quedó viejo en pantalla. */
  onMoved: () => Promise<void>;
}

/**
 * Mueve una cotización a otro catálogo mostrando el precio ANTES y DESPUÉS.
 *
 * Mover represia a propósito —es la única puerta que rompe el casamiento hecho
 * al crear—, así que nadie debe hacerlo a ciegas: la previa la calcula el
 * servidor con el mismo código que el movimiento real, para que el número que
 * aquí se aprueba sea exactamente el que se guarda.
 */
export function MoverCatalogoModal({
  quoteId,
  catalogoActual,
  totalActual,
  pagado,
  onClose,
  onMoved,
}: Props) {
  const [destinoId, setDestinoId] = useState('');
  const [error, setError] = useState('');

  const catalogosQ = usePriceLists();
  const opciones = (catalogosQ.data?.priceLists ?? []).filter((p) => p.id !== catalogoActual?.id);

  // El primer destino se preselecciona para que la previa aparezca sola; sin
  // esto habría que elegir dos veces (abrir el select y volver a elegir) para
  // ver un solo número. La dependencia es el id, no el arreglo: `opciones` se
  // reconstruye en cada render y dispararía el efecto sin parar.
  const primeraOpcion = opciones[0]?.id;
  useEffect(() => {
    if (!destinoId && primeraOpcion) setDestinoId(primeraOpcion);
  }, [destinoId, primeraOpcion]);

  const previaQ = useQuery({
    queryKey: ['catalogo-previa', quoteId, destinoId],
    queryFn: () =>
      api.post<{ antes: number; despues: number }>(`/api/quotes/${quoteId}/catalogo/simular`, {
        priceListId: destinoId,
      }),
    enabled: Boolean(destinoId),
    retry: false,
  });

  const mover = useMutation({
    mutationFn: () => api.post(`/api/quotes/${quoteId}/catalogo`, { priceListId: destinoId }),
    onSuccess: async () => {
      await onMoved();
      onClose();
    },
    onError: (err) => setError(apiErrorMessage(err, 'No se pudo mover la cotización.')),
  });

  const previa = previaQ.data;
  const diferencia = previa ? previa.despues - previa.antes : 0;
  const bajaDeLoPagado = previa != null && previa.despues < pagado;
  const nombreDestino = opciones.find((p) => p.id === destinoId)?.nombre ?? '';
  // Sin previa no se confirma: mover sin ver el precio es justo lo que este
  // modal existe para impedir.
  const puedeMover = Boolean(destinoId && previa) && !mover.isPending;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Mover de catálogo"
    >
      <Card className="w-full max-w-md space-y-4 p-6">
        <h2 className="font-display text-xl text-ink">Mover de catálogo</h2>
        <p className="text-sm text-charcoal">
          Esta cotización está casada al catálogo{' '}
          <strong>{catalogoActual?.nombre ?? 'sin catálogo'}</strong> y recalcula siempre contra él.
          Moverla la <strong>represia</strong> con los precios del catálogo que elijas.
        </p>

        {opciones.length === 0 && !catalogosQ.isLoading && (
          <p className="text-sm text-charcoal-soft">No hay otro catálogo al que moverla.</p>
        )}

        {opciones.length > 0 && (
          <Field label="Catálogo destino">
            <SelectInput
              value={destinoId}
              onChange={(e) => {
                setDestinoId(e.target.value);
                setError('');
              }}
            >
              {opciones.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.activa ? ' (activo)' : ''}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}

        {previaQ.isFetching && <p className="text-sm text-charcoal-soft">Calculando el precio…</p>}

        {previaQ.isError && (
          <p role="alert" className="text-sm text-wine">
            {apiErrorMessage(previaQ.error, 'No se pudo calcular el precio en ese catálogo.')}
          </p>
        )}

        {previa && !previaQ.isFetching && (
          <div className="space-y-1 rounded-lg bg-cream-200/70 px-3 py-2.5 text-sm text-ink">
            <p className="flex justify-between">
              <span className="text-charcoal-soft">Antes ({catalogoActual?.nombre ?? '—'})</span>
              <strong>{formatMXN(previa.antes)}</strong>
            </p>
            <p className="flex justify-between">
              <span className="text-charcoal-soft">Después ({nombreDestino})</span>
              <strong>{formatMXN(previa.despues)}</strong>
            </p>
            <p className="flex justify-between border-t border-cream-300 pt-1">
              <span className="text-charcoal-soft">Diferencia</span>
              <strong className={diferencia === 0 ? '' : diferencia > 0 ? 'text-wine' : 'text-emerald-700'}>
                {diferencia > 0 ? '+' : ''}
                {formatMXN(diferencia)}
              </strong>
            </p>
          </div>
        )}

        {bajaDeLoPagado && (
          <p className="flex items-start gap-2 rounded-lg border border-wine/30 bg-wine/10 px-3 py-2 text-sm text-wine">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              El total nuevo queda por debajo de lo ya pagado ({formatMXN(pagado)}). El evento
              quedará marcado con desfase para que alguien lo resuelva.
            </span>
          </p>
        )}

        <p className="text-xs text-charcoal-soft">
          Queda registrado en la bitácora con el total de antes y el de después. El total actual
          guardado es {formatMXN(totalActual)}.
        </p>

        {error && (
          <p role="alert" className="text-sm text-wine">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mover.isPending}>
            Cancelar
          </Button>
          <Button variant="gold" onClick={() => mover.mutate()} disabled={!puedeMover}>
            {mover.isPending ? 'Moviendo…' : 'Mover y represiar'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
