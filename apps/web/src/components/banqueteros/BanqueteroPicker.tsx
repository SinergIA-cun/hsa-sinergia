import { useMemo, useState, type ReactNode } from 'react';
import { Building2, Search, UserRound, X } from 'lucide-react';
import { coincide } from '../../lib/buscar.ts';

export interface BanqueteroLite {
  id: string;
  nombre: string;
  telefono: string | null;
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
    return banqueteros.filter((b) => coincide([b.nombre, b.telefono], needle));
  }, [banqueteros, needle]);

  const visibles = resultados.slice(0, TOPE_RESULTADOS);
  const ocultos = resultados.length - visibles.length;

  function elegir(id: string) {
    onChange(id);
    setQ('');
  }

  const opcion = (activo: boolean, label: string, icon: ReactNode, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
        activo ? 'bg-ink text-cream shadow-sm' : 'text-ink hover:bg-ink/5'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-soft">
        ¿Para quién es este evento?
      </p>
      <div className="flex gap-1 rounded-xl border border-cream-300 bg-cream-100/60 p-1">
        {opcion(modo === 'cliente', 'Cliente', <UserRound size={15} />, () => {
          onModo('cliente');
          // Cambiar de modo SÍ desliga: si no, un contrato capturado como
          // banquetero y corregido a cliente se guardaría con el banquetero
          // pegado y nadie lo vería en la pantalla.
          if (value !== '') elegir('');
        })}
        {opcion(modo === 'banquetero', 'Banquetero', <Building2 size={15} />, () =>
          onModo('banquetero'),
        )}
      </div>

      {modo === 'banquetero' && value !== '' && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold/5 px-3 py-2.5 text-sm">
          <span className="inline-flex items-center gap-2 text-ink">
            <Building2 size={15} className="text-gold" />
            <strong className="font-medium">{nombreActual || 'Banquetero'}</strong>
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
              placeholder="Busca al banquetero por nombre o teléfono…"
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
                    <span className="font-medium text-ink">{b.nombre}</span>
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
              </a>
              .
            </p>
          )}
          {!needle && (
            <p className="mt-1 text-xs text-charcoal-soft">
              Sin banquetero elegido, este contrato se guarda como venta directa a cliente.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
