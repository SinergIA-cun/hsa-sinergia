import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Lock } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { apiErrorMessage } from '../admin/shared.tsx';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Field, TextInput, SelectInput } from '../ui.tsx';
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
 * Pide SOLO lo que el apartado no tenía —tipo de evento, invitados y cliente— y
 * después lleva a la cotización para terminarla con el cotizador de siempre.
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
  const [cliente, setCliente] = useState('');
  const [telefono, setTelefono] = useState('');
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

  // Los dos motivos por los que convertir fallaría, dichos ANTES de intentarlo.
  const faltaDeposito =
    apartado.deposito > 0 && (!apartado.depositoMetodo || !apartado.depositoFecha);
  const faltaCatalogo = catalogQ.isError;

  const listo =
    !faltaDeposito &&
    !faltaCatalogo &&
    Boolean(eventTypeId) &&
    Number(invitados) > 0 &&
    cliente.trim().length > 0;

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
          client: { nombre: cliente.trim(), telefono: telefono.trim() || undefined },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-marfil p-6 shadow-xl">
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

        {apartado.deposito > 0 && !faltaDeposito && (
          <p className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-charcoal-soft">
            Su depósito de <strong className="text-ink">{formatMXN(apartado.deposito)}</strong> se
            acreditará como pago de la cotización nueva{' '}
            <strong className="text-ink">
              con la fecha en que se recibió ({formatEventDate(apartado.depositoFecha!)})
            </strong>
            , no con la de hoy: el ingreso se factura en el mes en que entró.
          </p>
        )}

        {faltaDeposito && (
          <p className="mt-3 rounded-lg border border-wine/30 bg-wine/5 p-3 text-xs text-wine">
            Este apartado tiene un depósito de {formatMXN(apartado.deposito)} sin forma de pago o
            sin fecha de recepción. Complétalos antes de convertir, o el pago se perdería.
          </p>
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
            label="Cliente"
            hint="El banquetero es el cliente de la hacienda: firma él y se le factura a él."
          >
            <TextInput
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder={banqueteroNombre}
            />
          </Field>

          <Field label="Teléfono del cliente" hint="Opcional.">
            <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          </Field>

          <Field label="Festejado" hint="Opcional. Va en la hoja operativa, no en el contrato.">
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
      </div>
    </div>
  );
}
