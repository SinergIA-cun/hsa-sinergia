import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck, Lock } from 'lucide-react';
import { api } from '../lib/api.ts';
import { ArrowDivider, Card } from '../components/ui.tsx';
import { QuoteForm, type QuotePayload } from '../components/QuoteForm.tsx';
import { formatEventDate } from '../lib/date.ts';
import { formatMXN } from '../lib/money.ts';
import type { ApartadoFecha, Catalog, Quote } from '../lib/types.ts';

interface CatalogoElegible {
  id: string;
  nombre: string;
  anio: number;
  activa: boolean;
}

/**
 * Convertir una fecha apartada en contrato.
 *
 * Antes esto era una ventanita con tres campos. El problema no era el tamaño:
 * era que convertir es ARMAR UN CONTRATO —tipo de evento, invitados, alimentos,
 * servicios, horas extra— y la ventanita solo dejaba capturar tres cosas. El
 * resto había que agregarlo después, editando el contrato recién creado, y sin
 * ver el precio hasta el final.
 *
 * Ahora es el mismo formulario de siempre, con el desglose en vivo al lado. Lo
 * que viene del apartado —la fecha, los espacios y el banquetero— se muestra
 * bloqueado: es lo que se apartó y lo que ya se pagó.
 */
export function ConvertirApartadoPage() {
  const { id: banqueteroId, apartadoId } = useParams<{ id: string; apartadoId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const apartadosQ = useQuery({
    queryKey: ['apartados', banqueteroId],
    queryFn: () => api.get<{ apartados: ApartadoFecha[] }>(`/api/banqueteros/${banqueteroId}/apartados`),
    enabled: Boolean(banqueteroId),
  });
  const apartado = apartadosQ.data?.apartados.find((a) => a.id === apartadoId);

  const { data: listas } = useQuery({
    queryKey: ['price-lists-elegibles'],
    queryFn: () => api.get<{ priceLists: CatalogoElegible[] }>('/api/price-lists'),
  });

  /**
   * El catálogo: manda el GARANTIZADO del apartado. Es una promesa que se le
   * hizo al banquetero, así que ni se elige ni se sugiere. Sin promesa, se
   * escoge como en cualquier contrato nuevo: por el año del evento.
   */
  const garantizado = apartado?.priceList?.id;
  const [elegido, setElegido] = useState<string | undefined>(undefined);
  const priceListId = garantizado ?? elegido;

  const catalogQ = useQuery({
    queryKey: ['catalog', priceListId ?? 'activo'],
    queryFn: () =>
      api.get<Catalog>(priceListId ? `/api/catalog?priceListId=${priceListId}` : '/api/catalog'),
    retry: false,
    placeholderData: (previo) => previo,
  });

  const abonosVivos = useMemo(
    () => (apartado?.abonos ?? []).filter((a) => a.anuladoAt == null),
    [apartado],
  );

  async function convertir(payload: QuotePayload) {
    setError('');
    try {
      const res = await api.post<{ quote: Quote }>(
        `/api/banqueteros/apartados/${apartadoId}/convertir`,
        payload,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['quotes'] }),
        qc.invalidateQueries({ queryKey: ['banquetero', banqueteroId] }),
        qc.invalidateQueries({ queryKey: ['apartados', banqueteroId] }),
      ]);
      navigate(`/cotizaciones/${res.quote.id}?creado=1`);
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : 'No se pudo convertir. Revisa los datos.',
      );
    }
  }

  const volver = (
    <Link
      to={`/banqueteros/${banqueteroId}`}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal-soft hover:text-ink"
    >
      <ArrowLeft size={15} /> Cuenta del banquetero
    </Link>
  );

  if (apartadosQ.isLoading) return <p className="text-charcoal-soft">Cargando el apartado…</p>;
  if (!apartado) {
    return (
      <div>
        {volver}
        <p className="text-wine">No se encontró ese apartado.</p>
      </div>
    );
  }
  if (apartado.quoteId) {
    return (
      <div>
        {volver}
        <p className="text-wine">Este apartado ya se convirtió en contrato.</p>
      </div>
    );
  }
  if (catalogQ.isError) {
    return (
      <div>
        {volver}
        <p className="text-wine">
          {apartado.priceList
            ? `No se pudo leer el catálogo ${apartado.priceList.nombre}.`
            : 'No hay catálogo activo, y este apartado no tiene precio garantizado. Un administrador tiene que activar uno antes de poder cotizar esta fecha.'}
        </p>
      </div>
    );
  }
  if (!catalogQ.data) return <p className="text-charcoal-soft">Cargando catálogo…</p>;

  return (
    <div>
      {volver}
      <ArrowDivider>Convertir</ArrowDivider>
      <h1 className="mb-2 mt-2 flex items-center gap-2 font-display text-4xl text-ink">
        <CalendarCheck size={28} className="text-gold" /> De fecha apartada a contrato
      </h1>
      <p className="mb-6 max-w-2xl text-sm text-charcoal-soft">
        Lo que se apartó ya está puesto. Falta lo que el apartado no tenía todavía: el tipo de
        evento, cuánta gente y lo que se contrate.
      </p>

      <Card className="mb-6 space-y-2 p-5">
        <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-charcoal-soft">
          <Lock size={11} /> Viene del apartado
        </p>
        <div className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <p>
            <span className="text-charcoal-soft">Fecha · </span>
            <span className="text-ink">{formatEventDate(apartado.fechaEvento, 'long')}</span>
          </p>
          <p>
            <span className="text-charcoal-soft">Banquetero · </span>
            <span className="text-ink">{apartado.banquetero?.nombre ?? '—'}</span>
          </p>
          <p>
            <span className="text-charcoal-soft">Catálogo · </span>
            <span className="text-ink">
              {apartado.priceList
                ? `${apartado.priceList.nombre} · precio garantizado`
                : 'se elige abajo, por el año del evento'}
            </span>
          </p>
        </div>

        {abonosVivos.length > 0 && (
          <div className="mt-2 rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-charcoal-soft">
            <p>
              Sus <strong className="text-ink">{formatMXN(apartado.abonado)}</strong> abonados se
              acreditarán como {abonosVivos.length === 1 ? 'un pago' : `${abonosVivos.length} pagos`}{' '}
              del contrato nuevo,{' '}
              <strong className="text-ink">cada uno con la fecha en que se recibió</strong> — no con
              la de hoy: el ingreso se factura en el mes en que entró.
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {abonosVivos.map((a) => (
                <li key={a.id} className="tabular-nums">
                  {formatEventDate(a.fecha)} · {formatMXN(a.monto)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <QuoteForm
        catalog={catalogQ.data}
        /* Sin precio garantizado se puede elegir; con él, no hay nada que elegir. */
        catalogos={garantizado ? undefined : (listas?.priceLists ?? [])}
        priceListId={priceListId}
        onPriceListChange={setElegido}
        initial={{
          fecha: apartado.fechaEvento.slice(0, 10),
          spaceIds: apartado.spaceIds,
          banqueteroId: apartado.banqueteroId,
          nombre: apartado.banquetero?.nombre ?? '',
        }}
        bloqueado={{ fecha: true, espacios: true, banquetero: true }}
        excludeApartadoId={apartado.id}
        submitLabel="Convertir en contrato"
        onSubmit={convertir}
        errorMsg={error}
      />
    </div>
  );
}
