import { useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { formatMXN } from '../lib/money.ts';
import type { AddOn } from '../lib/types.ts';

/**
 * El selector de servicios del catálogo al cotizar.
 *
 * Los servicios resultaron muchos más de los que se pensaba, y una sola lista
 * plana de casillas ya no se podía recorrer: para encontrar "Pista iluminada"
 * había que leerlos todos. Ahora:
 *
 *  - **Buscador** que ignora acentos y mayúsculas, sobre el nombre y la categoría.
 *  - **Más usados** arriba: los que más se repiten en las cotizaciones del mismo
 *    catálogo, que son los que se piden en casi todos los eventos.
 *  - **Categorías plegables** (las pone el admin en el catálogo). Se abren solas
 *    las que ya traen algo elegido, y cada encabezado dice cuántos lleva.
 *
 * Con pocos servicios y sin categorías se ve como antes: una lista sencilla.
 */

/** Con hasta este número de servicios no hace falta agruparlos ni sugerir. */
const POCOS = 8;
const MAS_USADOS = 6;
const SIN_CATEGORIA = 'Otros servicios';

const plano = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function unidad(a: AddOn): string {
  if (a.kind === 'porPersona') return ' /persona';
  if (a.kind === 'porUnidad') return a.nombre.toLowerCase().includes('hora') ? ' /hora' : ' /unidad';
  return '';
}

export function ServiciosSelector({
  servicios,
  seleccion,
  onToggle,
  onCantidad,
}: {
  /** Los que se ofrecen, más los dados de baja que esta cotización ya trae. */
  servicios: AddOn[];
  /** `addOnId → cantidad` de los elegidos. */
  seleccion: Record<string, number>;
  onToggle: (id: string) => void;
  onCantidad: (id: string, cantidad: number) => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const q = plano(busqueda.trim());
  const hayCategorias = servicios.some((s) => s.categoria);
  const sencillo = servicios.length <= POCOS && !hayCategorias;

  const grupos = useMemo(() => {
    const porCategoria = new Map<string, AddOn[]>();
    for (const s of servicios) {
      const c = s.categoria?.trim() || SIN_CATEGORIA;
      porCategoria.set(c, [...(porCategoria.get(c) ?? []), s]);
    }
    // Alfabético, con "Otros servicios" siempre al final.
    return [...porCategoria.entries()].sort(([a], [b]) =>
      a === SIN_CATEGORIA ? 1 : b === SIN_CATEGORIA ? -1 : a.localeCompare(b, 'es'),
    );
  }, [servicios]);

  const masUsados = useMemo(
    () =>
      [...servicios]
        .filter((s) => s.activo && (s.usos ?? 0) > 0)
        .sort((a, b) => (b.usos ?? 0) - (a.usos ?? 0) || a.nombre.localeCompare(b.nombre, 'es'))
        .slice(0, MAS_USADOS),
    [servicios],
  );

  const fila = (a: AddOn, mostrarCategoria = false) => (
    <FilaServicio
      key={a.id}
      servicio={a}
      cantidad={seleccion[a.id]}
      categoria={mostrarCategoria ? a.categoria : null}
      onToggle={() => onToggle(a.id)}
      onCantidad={(n) => onCantidad(a.id, n)}
    />
  );

  if (sencillo) return <div className="space-y-2">{servicios.map((a) => fila(a))}</div>;

  const resultados = q
    ? servicios.filter((s) => plano(`${s.nombre} ${s.categoria ?? ''}`).includes(q))
    : [];

  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">Buscar servicio</span>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft" />
        {/* `text` y no `search`: el de búsqueda trae su propia "x" y salían dos. */}
        <input
          type="text"
          role="searchbox"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={`Buscar entre ${servicios.length} servicios…`}
          className="w-full rounded-lg border border-ink/15 bg-white/70 py-2.5 pl-9 pr-9 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
        />
        {busqueda && (
          <button
            type="button"
            onClick={() => setBusqueda('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-charcoal-soft hover:bg-ink/5"
          >
            <X size={14} />
          </button>
        )}
      </label>

      {q ? (
        resultados.length > 0 ? (
          <div className="space-y-2">{resultados.map((a) => fila(a, true))}</div>
        ) : (
          <p className="rounded-lg bg-cream-100 px-3 py-2 text-sm text-charcoal-soft">
            Ningún servicio del catálogo se llama así. Si es solo para este evento, agrégalo abajo en{' '}
            <strong>Servicios de este evento</strong>.
          </p>
        )
      ) : (
        <>
          {masUsados.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">Más usados</p>
              {masUsados.map((a) => fila(a, true))}
            </div>
          )}
          {grupos.map(([categoria, lista]) => {
            const elegidos = lista.filter((s) => s.id in seleccion).length;
            return (
              <details
                key={categoria}
                // Abierta si ya lleva algo elegido: lo cobrado nunca queda escondido.
                open={elegidos > 0 || undefined}
                className="group rounded-lg border border-ink/10 bg-white/40"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <ChevronRight size={15} className="text-gold transition-transform group-open:rotate-90" />
                    {categoria}
                    <span className="text-xs font-normal text-charcoal-soft">{lista.length}</span>
                  </span>
                  {elegidos > 0 && (
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                      {elegidos} elegido{elegidos === 1 ? '' : 's'}
                    </span>
                  )}
                </summary>
                <div className="space-y-2 px-3 pb-3">{lista.map((a) => fila(a))}</div>
              </details>
            );
          })}
        </>
      )}
    </div>
  );
}

/** Un servicio: casilla, precio, cantidad si se cobra por unidad y el aviso si ya no se ofrece. */
function FilaServicio({
  servicio: a,
  cantidad,
  categoria,
  onToggle,
  onCantidad,
}: {
  servicio: AddOn;
  cantidad: number | undefined;
  categoria?: string | null;
  onToggle: () => void;
  onCantidad: (n: number) => void;
}) {
  const active = cantidad !== undefined;
  const dadoDeBaja = !a.activo;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm ${
        dadoDeBaja ? 'border-wine/50 bg-wine/5' : active ? 'border-gold/60 bg-gold/5' : 'border-ink/10 bg-white/60'
      }`}
    >
      <label className="flex flex-1 cursor-pointer items-center gap-3">
        <input type="checkbox" checked={active} onChange={onToggle} className="h-4 w-4 accent-[var(--color-gold)]" />
        <span className="flex-1">
          <span className="font-medium text-charcoal">{a.nombre}</span>{' '}
          <span className="text-xs text-charcoal-soft">
            {formatMXN(a.price)}
            {unidad(a)}
          </span>
          {categoria && <span className="ml-2 text-[0.7rem] text-charcoal-soft/80">· {categoria}</span>}
          {dadoDeBaja && (
            <span className="mt-1 block text-xs font-medium text-wine">
              Ya no se ofrece, pero se sigue cobrando en esta cotización. Quítalo para dejar de cobrarlo.
            </span>
          )}
        </span>
      </label>
      {active && a.kind === 'porUnidad' && (
        <input
          type="number"
          min={1}
          value={cantidad}
          aria-label={`Cantidad de ${a.nombre}`}
          onChange={(e) => onCantidad(Number(e.target.value))}
          className="w-20 rounded-md border border-ink/15 px-2 py-1 text-sm"
        />
      )}
    </div>
  );
}
