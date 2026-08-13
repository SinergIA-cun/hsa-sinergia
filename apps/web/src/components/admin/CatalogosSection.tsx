import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, Pencil } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { PRICE_LISTS_KEY, usePriceLists } from '../../lib/catalogos.ts';
import { formatMXN, formatPctFraccion } from '../../lib/money.ts';
import { Button, Card, Field, TextInput, SelectInput } from '../ui.tsx';
import type { PriceList } from '../../lib/types.ts';
import { apiErrorMessage } from './shared.tsx';
import { CatalogoEditor } from './catalogo/CatalogoEditor.tsx';

export function CatalogosSection() {
  const qc = useQueryClient();
  const { data, isLoading } = usePriceLists();
  const priceLists = data?.priceLists ?? [];
  /**
   * Qué catálogo se está editando, o `null` para el listado. El editor ocupa la
   * sección completa en vez de abrirse en un modal: son cinco superficies con
   * tablas, y un modal las deja sin espacio.
   */
  const [editandoId, setEditandoId] = useState<string | null>(null);

  /**
   * Activar o clonar cambia cuál es el catálogo activo, y de ahí cuelga el
   * cotizador (`catalog`). Sin invalidar las dos, la pantalla sigue mostrando
   * los precios del catálogo anterior.
   */
  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: PRICE_LISTS_KEY }),
      qc.invalidateQueries({ queryKey: ['catalog'] }),
    ]);
  }

  const activar = useMutation({
    mutationFn: (id: string) => api.post<{ priceList: PriceList }>(`/api/admin/price-lists/${id}/activar`),
    onSuccess: invalidate,
  });

  return (
    <section>
      <h2 className="mb-1 font-display text-2xl text-ink">Catálogos</h2>
      <p className="mb-4 max-w-3xl text-sm text-charcoal-soft">
        Cada cotización queda casada al catálogo con el que se coteó y recalcula siempre contra él.
        Por eso crear el catálogo del año que viene —o activarlo— nunca cambia el precio de lo ya
        cotizado.
      </p>
      {editandoId ? (
        <CatalogoEditor
          priceListId={editandoId}
          onCerrar={() => setEditandoId(null)}
          onCambiarCatalogo={setEditandoId}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-6">
            {isLoading && <p className="text-sm text-charcoal-soft">Cargando…</p>}
            {!isLoading && priceLists.length === 0 && (
              <p className="text-sm text-charcoal-soft">Todavía no hay catálogos.</p>
            )}
            {!isLoading && priceLists.length > 0 && (
              <ul className="divide-y divide-cream-300">
                {priceLists.map((pl) => (
                  <CatalogoRow
                    key={pl.id}
                    priceList={pl}
                    onActivar={() => activar.mutateAsync(pl.id)}
                    onEditar={() => setEditandoId(pl.id)}
                    busy={activar.isPending}
                  />
                ))}
              </ul>
            )}
          </Card>

          <NuevoCatalogoCard priceLists={priceLists} onCreated={invalidate} />
        </div>
      )}
    </section>
  );
}

function CatalogoRow({
  priceList: pl,
  onActivar,
  onEditar,
  busy,
}: {
  priceList: PriceList;
  onActivar: () => Promise<unknown>;
  onEditar: () => void;
  busy: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState('');

  async function confirmar() {
    setError('');
    try {
      await onActivar();
      setArmed(false);
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo activar el catálogo.'));
    }
  }

  return (
    <li className="space-y-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-medium text-ink">
            {pl.nombre}
            {pl.activa && (
              <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gold">
                Activo
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-charcoal-soft">
            Año {pl.anio} · {pl.cotizaciones} cotizaciones · {pl.renta} renglones de renta ·{' '}
            {pl.servicios} servicios · {pl.paquetes} paquetes
          </p>
          <p className="mt-0.5 text-xs text-charcoal-soft/80">
            IVA {formatPctFraccion(pl.ivaRate)} · hora extra {formatPctFraccion(pl.extraHourRate)} ·
            descuento alimentos {formatPctFraccion(pl.foodDiscountRate)} · capilla sábado{' '}
            {formatMXN(pl.capillaSabado)}
          </p>
          <DjPrecios dj={pl.dj} />
        </div>
        <div className="flex items-center gap-1">
          {/* Editar el contenido: precios de renta, servicios, alimentos, DJ y
              parámetros. Se puede sobre cualquier catálogo, incluido el activo y
              uno en uso; el editor avisa del impacto antes. */}
          <Button type="button" variant="outline" className="px-2.5 py-1.5 text-xs" onClick={onEditar}>
            <Pencil size={13} /> Editar
          </Button>
          {!pl.activa && !armed && (
            <Button
              type="button"
              variant="ghost"
              className="px-2.5 py-1.5 text-xs"
              disabled={busy}
              onClick={() => setArmed(true)}
            >
              <Check size={13} /> Activar
            </Button>
          )}
        </div>
      </div>

      {armed && (
        <div className="space-y-2 rounded-lg bg-cream-200/70 px-3 py-2.5">
          {/* La intuición de cualquiera es la contraria, y ese miedo es razonable:
              hay que decirlo antes de que aprieten el botón. */}
          <p className="text-sm text-ink">
            Activar <strong>{pl.nombre}</strong> solo afecta a las{' '}
            <strong>cotizaciones nuevas</strong>. Las que ya existen siguen casadas a su catálogo y
            no cambian de precio.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="px-2.5 py-1.5 text-xs"
              disabled={busy}
              onClick={() => {
                setArmed(false);
                setError('');
              }}
            >
              Cancela
            </Button>
            <Button
              type="button"
              variant="gold"
              className="px-2.5 py-1.5 text-xs"
              disabled={busy}
              onClick={() => void confirmar()}
            >
              {busy ? 'Activando…' : `Sí, activar ${pl.nombre}`}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-wine">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * El DJ por hora extra, por tipo de evento. Solo lectura en este tramo: editar
 * los precios línea por línea es del tramo 2.
 *
 * Lo que un tipo de evento NO tiene aquí es información, no un hueco: sin
 * renglón, ese tipo de evento no ofrece el servicio y la casilla no cobra nada.
 */
function DjPrecios({ dj }: { dj: PriceList['dj'] }) {
  if (dj.length === 0) {
    return (
      <p className="mt-1.5 text-xs text-charcoal-soft/80">
        DJ hora extra: <span className="text-wine">sin precios</span> — ningún tipo de evento lo
        ofrece en este catálogo.
      </p>
    );
  }
  return (
    <div className="mt-1.5">
      <p className="text-xs font-medium text-charcoal-soft">DJ hora extra (por tipo de evento)</p>
      <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {dj.map((d) => (
          <li key={d.eventTypeId} className="text-xs text-charcoal-soft/80">
            {d.eventType} <span className="font-medium text-ink/80">{formatMXN(d.price)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NuevoCatalogoCard({
  priceLists,
  onCreated,
}: {
  priceLists: PriceList[];
  onCreated: () => Promise<void>;
}) {
  const activo = priceLists.find((p) => p.activa);
  const [nombre, setNombre] = useState('');
  const [anio, setAnio] = useState('');
  // `null` = nadie ha tocado el select todavía, así que manda el activo. La
  // cadena vacía SÍ es una elección ("empezar vacío"); si se usara `''` como
  // "sin tocar", esa opción sería imposible de elegir: el fallback la pisaría.
  const [clonarDe, setClonarDe] = useState<string | null>(null);
  const [incrementoPct, setIncrementoPct] = useState('');
  const [error, setError] = useState('');
  const [creado, setCreado] = useState('');

  const origen = clonarDe ?? activo?.id ?? '';

  const crear = useMutation({
    mutationFn: () =>
      api.post<{ priceList: PriceList }>('/api/admin/price-lists', {
        nombre: nombre.trim(),
        anio: Number(anio),
        ...(origen ? { clonarDe: origen } : {}),
        ...(incrementoPct.trim() ? { incrementoPct: Number(incrementoPct) } : {}),
      }),
    onSuccess: async (res) => {
      setCreado(res.priceList.nombre);
      setNombre('');
      setAnio('');
      setIncrementoPct('');
      setError('');
      await onCreated();
    },
    onError: (err) => {
      setCreado('');
      setError(apiErrorMessage(err, 'No se pudo crear el catálogo.'));
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const anioNum = Number(anio);
    if (!nombre.trim() || !Number.isInteger(anioNum) || anioNum < 2000 || anioNum > 2100) {
      setError('Pon un nombre y un año entre 2000 y 2100.');
      return;
    }
    if (incrementoPct.trim() && Number.isNaN(Number(incrementoPct))) {
      setError('El porcentaje debe ser un número.');
      return;
    }
    setError('');
    crear.mutate();
  }

  return (
    <Card className="space-y-4 p-6">
      <h3 className="font-display text-lg text-ink">Nuevo catálogo</h3>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Nombre">
          <TextInput
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="2028"
          />
        </Field>
        <Field label="Año">
          <TextInput
            type="number"
            min={2000}
            max={2100}
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            placeholder="2028"
          />
        </Field>
        <Field label="Clonar de">
          <SelectInput value={origen} onChange={(e) => setClonarDe(e.target.value)}>
            {priceLists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.activa ? ' (activo)' : ''}
              </option>
            ))}
            <option value="">Empezar vacío (sin precios)</option>
          </SelectInput>
        </Field>
        <Field
          label="Incremento (%)"
          hint="Se aplica a la renta, a los servicios y a los paquetes de alimentos. No se aplica a la tarifa de capilla en sábado ni al IVA, la hora extra o el descuento por alimentos: esos se copian tal cual."
        >
          <TextInput
            type="number"
            step="0.01"
            value={incrementoPct}
            onChange={(e) => setIncrementoPct(e.target.value)}
            placeholder="0"
          />
        </Field>

        {/* Nace inactivo a propósito: crear el catálogo del año que viene no debe
            cambiar el precio de lo que se cotiza hoy. */}
        <p className="text-xs text-charcoal-soft">
          El catálogo nuevo nace <strong>inactivo</strong>. Actívalo cuando quieras que las
          cotizaciones nuevas lo usen.
        </p>

        {error && <p className="text-xs text-wine">{error}</p>}
        {creado && !error && (
          <p className="text-xs text-emerald-700">
            Catálogo “{creado}” creado, inactivo. Revísalo y actívalo cuando toque.
          </p>
        )}
        <Button type="submit" variant="gold" disabled={crear.isPending} className="w-full">
          <Copy size={16} /> {crear.isPending ? 'Creando…' : 'Crear catálogo'}
        </Button>
      </form>
    </Card>
  );
}
