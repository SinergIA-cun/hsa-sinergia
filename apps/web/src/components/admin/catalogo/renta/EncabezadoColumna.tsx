import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, ChevronDown } from 'lucide-react';
import { INICIAL_DIA_SEMANA, NOMBRE_DIA_SEMANA, NOMBRE_MES, describirRegla, type ColumnaRenta } from '@hsa/shared';

const INICIAL_MES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
// La semana empieza en lunes, como se lee un calendario aquí.
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

const alternar = (xs: number[], x: number) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x].sort((a, b) => a - b));

function Chip({ activo, onClick, titulo, children }: { activo: boolean; onClick: () => void; titulo: string; children: string }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={activo}
      onClick={onClick}
      className={`h-7 w-7 rounded-full text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${
        activo ? 'bg-ink text-cream' : 'bg-cream-200/70 text-charcoal-soft hover:bg-cream-300'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * El encabezado de una columna de la hoja de renta: el nombre se escribe ahí
 * mismo, y debajo va su regla ("vie · mar–may") que abre el panel para elegir
 * días, meses y a qué columna cae si una celda queda vacía.
 */
export function EncabezadoColumna({
  columna,
  otras,
  bloqueada,
  puedeBorrar,
  onCambiar,
  onBorrar,
}: {
  columna: ColumnaRenta;
  otras: ColumnaRenta[];
  /** Catálogo en uso: el nombre sí, la regla no. */
  bloqueada: boolean;
  puedeBorrar: boolean;
  onCambiar: (c: ColumnaRenta) => void;
  onBorrar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  // El panel va en un portal con posición fija: dentro de la tabla, el scroll
  // horizontal lo cortaba.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const ANCHO = 288;

  function abrir() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - ANCHO - 8)) });
    setAbierto(true);
  }

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panel.current?.contains(t)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    const cerrar = () => setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', cerrar, true);
    window.addEventListener('resize', cerrar);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', cerrar, true);
      window.removeEventListener('resize', cerrar);
    };
  }, [abierto]);

  const respaldo = otras.find((o) => o.clave === columna.respaldo);

  return (
    <div ref={ref} className="relative">
      <input
        value={columna.nombre}
        onChange={(e) => onCambiar({ ...columna, nombre: e.target.value })}
        aria-label="Nombre de la columna"
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink hover:border-cream-300 focus:border-gold focus:bg-white focus:outline-none"
      />
      <button
        type="button"
        onClick={() => (bloqueada ? undefined : abierto ? setAbierto(false) : abrir())}
        disabled={bloqueada}
        title={bloqueada ? 'El catálogo ya está en uso: la regla no se cambia' : 'Qué días cobra esta columna'}
        className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.68rem] font-normal normal-case tracking-normal text-gold hover:bg-gold/10 disabled:cursor-default disabled:text-charcoal-soft disabled:hover:bg-transparent"
      >
        <span className="truncate">{describirRegla(columna)}</span>
        {!bloqueada && <ChevronDown size={11} className="shrink-0" />}
      </button>
      {respaldo && (
        <p className="px-1.5 text-[0.65rem] font-normal normal-case tracking-normal text-charcoal-soft">
          vacía → {respaldo.nombre}
        </p>
      )}

      {abierto && pos && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label={`Regla de ${columna.nombre}`}
          style={{ top: pos.top, left: pos.left, width: ANCHO }}
          className="fixed z-50 space-y-3 rounded-xl border border-cream-300 bg-white p-3 text-left normal-case tracking-normal shadow-lg"
        >
          <div>
            <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-wide text-charcoal-soft">Días</p>
            <div className="flex gap-1">
              {ORDEN_DIAS.map((d) => (
                <Chip
                  key={d}
                  activo={columna.dias.includes(d)}
                  titulo={NOMBRE_DIA_SEMANA[d]!}
                  onClick={() => onCambiar({ ...columna, dias: alternar(columna.dias, d) })}
                >
                  {INICIAL_DIA_SEMANA[d]!}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[0.68rem] font-medium uppercase tracking-wide text-charcoal-soft">Meses</p>
              <button
                type="button"
                onClick={() => onCambiar({ ...columna, meses: [] })}
                className={`text-[0.68rem] ${columna.meses.length === 0 ? 'font-semibold text-ink' : 'text-gold hover:underline'}`}
              >
                Todo el año
              </button>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {INICIAL_MES.map((m, i) => (
                <Chip
                  key={i}
                  activo={columna.meses.includes(i + 1)}
                  titulo={NOMBRE_MES[i]!}
                  onClick={() => onCambiar({ ...columna, meses: alternar(columna.meses, i + 1) })}
                >
                  {m}
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-[0.68rem] leading-snug text-charcoal-soft">
              Si un día cae en dos columnas, gana la que tiene meses (la más específica).
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block text-[0.68rem] font-medium uppercase tracking-wide text-charcoal-soft">
              Celda vacía se cobra como
            </span>
            <select
              value={columna.respaldo ?? ''}
              onChange={(e) => onCambiar({ ...columna, respaldo: e.target.value || null })}
              className="w-full rounded-lg border border-cream-300 bg-white px-2 py-1.5 text-sm text-ink focus:border-gold focus:outline-none"
            >
              <option value="">No se ofrece</option>
              {otras.map((o) => (
                <option key={o.clave} value={o.clave}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!puedeBorrar}
            onClick={() => {
              setAbierto(false);
              onBorrar();
            }}
            className="inline-flex items-center gap-1.5 text-xs text-wine hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={13} /> Borrar columna
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
