import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Lock } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { apiErrorMessage } from '../admin/shared.tsx';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Card, Field, TextInput, SelectInput } from '../ui.tsx';
import type { ApartadoFecha, Catalog } from '../../lib/types.ts';

interface Props {
  apartado: ApartadoFecha;
  banqueteroNombre: string;
  nombreEspacio: (id: string) => string;
  onListo: () => Promise<void>;
  onCerrar: () => void;
}

/**
 * Convertir un apartado en cotización.
 *
 * Pide SOLO lo que el apartado no tenía —tipo de evento e invitados— y después
 * lleva a la cotización para terminarla con el cotizador de siempre. El cliente
 * no se pregunta: con banquetero, él es el cliente de la hacienda.
 *
 * No se replica aquí el formulario completo a propósito: sería un segundo camino
 * al mismo dato, que es justo lo que este proyecto lleva semanas eliminando. Y lo
 * que el servidor IMPONE (fecha, espacios, banquetero y catálogo) se muestra fijo
 * y con su motivo a la vista: un campo editable cuyo valor el servidor ignora es
 * peor que uno bloqueado, porque miente.
 */
export function ConvertirApartadoModal({
  apartado,
  banqueteroNombre,
  nombreEspacio,
  onListo,
  onCerrar,
}: Props) {
  const navigate = useNavigate();
  const [eventTypeId, setEventTypeId] = useState('');
  const [invitados, setInvitados] = useState('');
  const [festejado, setFestejado] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // El catálogo del apartado si tiene precio garantizado; el activo si no. Es el
  // mismo que va a usar el servidor, así que el desplegable de tipos de evento
  // no puede ofrecer uno que su catálogo no cotice.
  const catalogQ = useQuery({
    queryKey: ['catalog', apartado.priceList?.id ?? 'activo'],
    queryFn: () =>
      api.get<Catalog>(
        apartado.priceList ? `/api/catalog?priceListId=${apartado.priceList.id}` : '/api/catalog',
      ),
    retry: false,
  });

  // El único motivo por el que convertir fallaría, dicho ANTES de intentarlo.
  const faltaCatalogo = catalogQ.isError;
  const abonosVivos = apartado.abonos.filter((a) => a.anuladoAt == null);

  const listo =
    !faltaCatalogo &&
    Boolean(eventTypeId) &&
    Number(invitados) > 0;

  async function convertir() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ quote: { id: string } }>(
        `/api/banqueteros/apartados/${apartado.id}/convertir`,
        {
          eventTypeId,
          invitados: Number(invitados),
          horasExtra: 0,
          addOns: [],
          extras: [],
          festejado: festejado.trim() || undefined,
        },
      );
      await onListo();
      navigate(`/cotizaciones/${res.quote.id}?creado=1`);
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo convertir el apartado.'));
      setBusy(false);
    }
  }

  return (
    // `bg-marfil` no existe en esta paleta —el marfil es `cream`— así que el
    // panel salía TRANSPARENTE y se veía la página encima: el "se empalma" que
    // reportó el dueño. Se usa `Card`, que es lo que usan los otros modales.
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/40 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label="Convertir el apartado en cotización"
    >
      {/* `bg-cream` encima de la Card: un diálogo tiene que TAPAR. La Card
          normal es blanco al 80% y sobre el velo oscuro se sigue transparentando,
          que es lo que se veía como "se empalma". */}
      <Card className="w-full max-w-lg bg-cream p-6">
        <h2 className="flex items-center gap-2 font-display text-2xl text-ink">
          <CalendarCheck size={20} className="text-gold" /> Convertir en cotización
        </h2>

        {/* Lo que viene del apartado y el servidor no deja cambiar. */}
        <div className="mt-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
          <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-charcoal-soft">
            <Lock size={11} /> Viene del apartado, no se puede cambiar
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-soft">Fecha</dt>
              <dd className="text-ink">{formatEventDate(apartado.fechaEvento, 'long')}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-soft">Espacios</dt>
              <dd className="text-ink">{apartado.spaceIds.map(nombreEspacio).join(' y ')}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-soft">Banquetero</dt>
              <dd className="text-ink">{banqueteroNombre}</dd>
            </div>
            {/* El cliente NO se pregunta: con banquetero, él es el cliente de la
                hacienda —firma él y se le factura a él—, la misma regla que el
                cotizador aplica desde el Plan H. Preguntarlo invitaba a teclear
                otro nombre y crear un cliente paralelo del mismo señor. */}
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-soft">Cliente</dt>
              <dd className="text-ink">{banqueteroNombre}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-soft">Catálogo</dt>
              <dd className="text-ink">
                {apartado.priceList
                  ? `${apartado.priceList.nombre} · precio garantizado`
                  : 'el que esté activo'}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-charcoal-soft">
            Es lo que se apartó y lo que se pagó. El precio se calcula con ese catálogo.
          </p>
        </div>

        {abonosVivos.length > 0 && (
          <div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-charcoal-soft">
            <p>
              Sus <strong className="text-ink">{formatMXN(apartado.abonado)}</strong> abonados se
              acreditarán como {abonosVivos.length === 1 ? 'un pago' : `${abonosVivos.length} pagos`}{' '}
              de la cotización nueva,{' '}
              <strong className="text-ink">cada uno con la fecha en que se recibió</strong> — no con
              la de hoy: el ingreso se factura en el mes en que entró.
            </p>
            <ul className="mt-2 space-y-0.5">
              {abonosVivos.map((a) => (
                <li key={a.id} className="tabular-nums">
                  {formatEventDate(a.fecha)} · {formatMXN(a.monto)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {faltaCatalogo && (
          <p className="mt-3 rounded-lg border border-wine/30 bg-wine/5 p-3 text-xs text-wine">
            {apartado.priceList
              ? `No se pudo leer el catálogo ${apartado.priceList.nombre}.`
              : 'No hay catálogo activo, y este apartado no tiene precio garantizado. Un administrador tiene que activar uno antes de poder cotizar esta fecha.'}
          </p>
        )}

        <div className="mt-4 space-y-3">
          <Field label="Tipo de evento" hint="Es lo que el apartado no tenía todavía.">
            <SelectInput value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)}>
              <option value="">Elige…</option>
              {(catalogQ.data?.eventTypes ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Field label="Invitados">
            <TextInput
              type="number"
              min={1}
              value={invitados}
              onChange={(e) => setInvitados(e.target.value)}
              placeholder="250"
            />
          </Field>

          <Field
            label="Festejado (el cliente final)"
            hint="Opcional. Va en la hoja operativa, no en el contrato: la hacienda no se mete en la reventa."
          >
            <TextInput
              value={festejado}
              onChange={(e) => setFestejado(e.target.value)}
              placeholder="Generación 2028"
            />
          </Field>
        </div>

        <p className="mt-3 text-xs text-charcoal-soft">
          Al convertir se abre la cotización para terminarla: alimentos, horas extra, servicios y
          lo demás se capturan ahí con el cotizador de siempre.
        </p>

        {error && <p className="mt-3 text-sm text-wine">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" onClick={convertir} disabled={!listo || busy}>
            {busy ? 'Convirtiendo…' : 'Convertir y abrir la cotización'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
