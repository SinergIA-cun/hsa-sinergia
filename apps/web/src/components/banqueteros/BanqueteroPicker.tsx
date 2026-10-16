import { useMemo, useState, type ReactNode } from 'react';
import { Search, Sparkles, UserRound, X } from 'lucide-react';
import { coincideTexto, TIPO_PROFESIONAL, type TipoProfesional } from '@hsa/shared';

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

  const needle = q.trim();
  const resultados = useMemo(() => {
    if (!needle) return [];
    return banqueteros.filter((b) => coincideTexto([b.nombre, b.telefono, b.tipo ? TIPO_PROFESIONAL[b.tipo].label : null], needle));
  }, [banqueteros, needle]);

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
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
            />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Busca al profesional por nombre o teléfono…"
              className="w-full rounded-lg border border-ink/15 bg-white/70 py-2.5 pl-9 pr-3 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
            />
          </div>
          {needle && visibles.length > 0 && (
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
          {needle && visibles.length === 0 && (
            <p className="mt-1 text-xs text-charcoal-soft">
              Sin coincidencias. Si es nuevo, un admin lo da de alta en{' '}
              <a href="/banqueteros" className="underline">
                Banqueteros
              </a>{' '}
              (ahí van también wedding planners y organizadores).
            </p>
          )}
          {!needle && (
            <p className="mt-1 text-xs text-charcoal-soft">
              Sin profesional elegido, este contrato se guarda como venta directa a cliente.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
