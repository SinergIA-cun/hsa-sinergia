import { useMemo, useState, type ReactNode } from 'react';
import { Search, Sparkles, UserRound, X } from 'lucide-react';
import { coincideTexto, TIPO_PROFESIONAL, TIPOS_PROFESIONAL, type TipoProfesional } from '@hsa/shared';

export interface BanqueteroLite {
  id: string;
  nombre: string;
  telefono: string | null;
  tipo?: TipoProfesional;
}

/** Cuántas coincidencias se pintan antes de pedir que se teclee un poco más. */
const TOPE_RESULTADOS = 8;

/**
 * ¿Para quién es este evento? Interruptor + buscador.
 *
 * Antes era un desplegable con todos los banqueteros dentro. Con cinco se veía
 * bien; con doscientos es una lista imposible de recorrer, y además metía dos
 * preguntas distintas en un mismo control: *qué tipo* de venta es y *cuál*
 * banquetero. Aquí van separadas —el interruptor decide el tipo, el buscador
 * encuentra al banquetero— que es también el orden en que se piensa al capturar.
 *
 * Los nombres son los de Jorge (15-oct-2026): "Cliente o empresa" y
 * "Profesional de eventos" —wedding planners, banqueteros, quien organiza
 * graduaciones—, que es como piensan en quien les trae el evento. Por dentro
 * sigue siendo el "banquetero" de siempre: el profesional firma y se le factura.
 *
 * El interruptor nunca elige banquetero por su cuenta. Preseleccionar "el
 * primero de la lista" es como se firma un contrato a nombre de quien no era.
 */
export type ModoVenta = 'cliente' | 'banquetero';

export function BanqueteroPicker({
  banqueteros,
  value,
  nombreActual,
  onChange,
  modo,
  onModo,
}: {
  /** Los activos, más el de esta cotización aunque esté dado de baja. */
  banqueteros: BanqueteroLite[];
  /** Id elegido; `''` = cliente directo. */
  value: string;
  /** Nombre del elegido, para pintarlo sin depender de que siga en la lista. */
  nombreActual: string;
  onChange: (id: string) => void;
  /**
   * Modo ≠ selección: se puede estar en "Banquetero" sin haber elegido a nadie
   * todavía —ese es justo el momento en que el buscador tiene sentido—. Vive en
   * el formulario porque él también lo necesita: mientras se busca banquetero,
   * el buscador de clientes estorba.
   */
  modo: ModoVenta;
  onModo: (m: ModoVenta) => void;
}) {
  const [q, setQ] = useState('');
  // Qué tipo de profesional es (Jorge, 16-oct-2026: "¿cómo selecciono si es
  // wedding planner, banquetero de graduación…?"). El tipo es del profesional
  // —se fija en su alta—, así que aquí filtra: al tocarlo aparecen los de ese
  // tipo sin tener que teclear nada.
  const [tipo, setTipo] = useState<TipoProfesional | null>(null);

  const needle = q.trim();
  const resultados = useMemo(() => {
    if (!needle && !tipo) return [];
    return banqueteros.filter(
      (b) =>
        (!tipo || b.tipo === tipo) &&
        (!needle || coincideTexto([b.nombre, b.telefono, b.tipo ? TIPO_PROFESIONAL[b.tipo].label : null], needle)),
    );
  }, [banqueteros, needle, tipo]);
  const cuantosPorTipo = useMemo(() => {
    const m = new Map<TipoProfesional, number>();
    for (const b of banqueteros) if (b.tipo) m.set(b.tipo, (m.get(b.tipo) ?? 0) + 1);
    return m;
  }, [banqueteros]);
  const tipoElegido = banqueteros.find((b) => b.id === value)?.tipo;

  const visibles = resultados.slice(0, TOPE_RESULTADOS);
  const ocultos = resultados.length - visibles.length;

  function elegir(id: string) {
    onChange(id);
    setQ('');
  }

  const opcion = (activo: boolean, titulo: string, detalle: string, icon: ReactNode, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`group flex flex-1 items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${
        activo ? 'bg-ink text-cream shadow-sm' : 'text-ink hover:bg-ink/5'
      }`}
    >
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          activo ? 'bg-gold text-ink' : 'bg-cream-300/70 text-ink'
        }`}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold">{titulo}</span>
        <span className={`mt-0.5 block text-xs leading-snug ${activo ? 'text-cream/75' : 'text-charcoal-soft'}`}>
          {detalle}
        </span>
      </span>
    </button>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-soft">
        ¿Para quién es este evento?
      </p>
      <div className="flex flex-col gap-1 rounded-xl border border-cream-300 bg-cream-100/60 p-1 sm:flex-row">
        {opcion(modo === 'cliente', 'Cliente o empresa', 'Contrata directo con la hacienda.', <UserRound size={15} />, () => {
          onModo('cliente');
          // Cambiar de modo SÍ desliga: si no, un contrato capturado como
          // banquetero y corregido a cliente se guardaría con el banquetero
          // pegado y nadie lo vería en la pantalla.
          if (value !== '') elegir('');
        })}
        {opcion(
          modo === 'banquetero',
          'Profesional de eventos',
          'Wedding planners, banqueteros, graduaciones… Firma y se le factura a él.',
          <Sparkles size={15} />,
          () => onModo('banquetero'),
        )}
      </div>

      {modo === 'banquetero' && value !== '' && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold/5 px-3 py-2.5 text-sm">
          <span className="inline-flex items-center gap-2 text-ink">
            <Sparkles size={15} className="text-gold" />
            <strong className="font-medium">{nombreActual || 'Profesional de eventos'}</strong>
            {tipoElegido && <span className="text-xs text-charcoal-soft">{TIPO_PROFESIONAL[tipoElegido].label}</span>}
          </span>
          <button
            type="button"
            onClick={() => elegir('')}
            className="inline-flex items-center gap-1 text-xs text-charcoal-soft hover:text-ink"
          >
            <X size={13} /> Cambiar
          </button>
        </div>
      )}

      {modo === 'banquetero' && value === '' && (
        <div>
          <div role="group" aria-label="Tipo de profesional" className="mb-2 flex flex-wrap gap-1.5">
            {TIPOS_PROFESIONAL.map((t) => {
              const activo = tipo === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setTipo(activo ? null : t)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${
                    activo ? 'border-ink bg-ink text-cream' : 'border-cream-300 bg-white/70 text-ink hover:border-gold/60'
                  }`}
                >
                  {TIPO_PROFESIONAL[t].label}
                  <span className={`ml-1.5 ${activo ? 'text-cream/70' : 'text-charcoal-soft'}`}>{cuantosPorTipo.get(t) ?? 0}</span>
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
            />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tipo ? `${TIPO_PROFESIONAL[tipo].label}: busca por nombre o teléfono…` : 'Busca al profesional por nombre o teléfono…'}
              className="w-full rounded-lg border border-ink/15 bg-white/70 py-2.5 pl-9 pr-3 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
            />
          </div>
          {(needle || tipo) && visibles.length > 0 && (
            <ul className="mt-1 divide-y divide-cream-200 overflow-hidden rounded-lg border border-cream-300 bg-white shadow-sm">
              {visibles.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => elegir(b.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-cream-100"
                  >
                    <span className="font-medium text-ink">
                      {b.nombre}
                      {b.tipo && <span className="ml-2 text-xs font-normal text-charcoal-soft">{TIPO_PROFESIONAL[b.tipo].label}</span>}
                    </span>
                    {b.telefono && <span className="text-xs text-charcoal-soft">{b.telefono}</span>}
                  </button>
                </li>
              ))}
              {ocultos > 0 && (
                <li className="px-3 py-2 text-xs text-charcoal-soft">
                  y {ocultos} más — teclea un poco más para afinar.
                </li>
              )}
            </ul>
          )}
          {(needle || tipo) && visibles.length === 0 && (
            <p className="mt-1 text-xs text-charcoal-soft">
              {tipo && !needle ? `Todavía no hay nadie dado de alta como «${TIPO_PROFESIONAL[tipo].label}».` : 'Sin coincidencias.'} Si es nuevo, un admin lo da de alta en{' '}
              <a href="/banqueteros" className="underline">
                Banqueteros
              </a>{' '}
              (ahí van también wedding planners y organizadores).
            </p>
          )}
          {!needle && !tipo && (
            <p className="mt-1 text-xs text-charcoal-soft">
              Elige el tipo o busca por nombre. Sin profesional elegido, este contrato se guarda como venta directa a cliente.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
