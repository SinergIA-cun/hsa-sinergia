import { useMemo, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { nombreCortoEspacio, type ColumnaRenta } from '@hsa/shared';
import type { RentaRenglon } from '../../../lib/types.ts';
import { bandasDeGrupo } from '../../../lib/bandasDeGrupo.ts';
import { BarraGuardar, useGuardar } from './guardado.tsx';
import { EncabezadoColumna } from './renta/EncabezadoColumna.tsx';
import { aPayload, claveNueva, hojaDe, leerPesos, ordenar, pegarBloque, revisar, type Fila, type Hoja } from './renta/hoja.ts';

export type TablaRentaPayload = ReturnType<typeof aPayload>;

const TIPOS = [
  { tipo: 'dia' as const, titulo: 'Renta' },
  { tipo: 'plano' as const, titulo: 'Renta plana (Team Building)' },
];

const miles = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

/**
 * La tabla de renta como una hoja de cálculo (16-oct-2026): se escribe en la
 * celda, se navega con flechas y Enter, se pega un bloque copiado de Excel, y se
 * agregan o quitan columnas (con su regla de días y meses), rangos y salones.
 * Una celda vacía es "sin precio": ese día no se ofrece, o se cobra como la
 * columna de respaldo.
 *
 * La red está al guardar, no al teclear: rangos sin huecos ni traslapes por
 * salón, columnas sin empates. Mientras haya un error, no se guarda.
 *
 * En un catálogo que ya usan eventos solo se cambian precios y nombres: quitar
 * un rango o cambiar la regla de una columna dejaría a esos eventos sin poder
 * recalcularse. La API lo exige igual.
 */
export function RentaSeccion({
  renta,
  columnas,
  espacios,
  enUso,
  onGuardar,
}: {
  renta: RentaRenglon[];
  columnas: ColumnaRenta[];
  espacios: { id: string; nombre: string; activo: boolean }[];
  /** Cuántos eventos usan el catálogo: con alguno, la estructura no se toca. */
  enUso: number;
  onGuardar: (tabla: TablaRentaPayload) => Promise<unknown>;
}) {
  const base = useMemo(() => hojaDe(renta, columnas), [renta, columnas]);
  const [borrador, setBorrador] = useState<Hoja | null>(null);
  const hoja = borrador ?? base;
  const { correr, pendiente, error, ok, limpiar } = useGuardar('No se pudo guardar la renta.');
  const rev = useMemo(() => revisar(hoja), [hoja]);
  const bloqueada = enUso > 0;

  const cambios = useMemo(() => contarCambios(base, hoja), [base, hoja]);
  const editar = (fn: (h: Hoja) => Hoja) => {
    limpiar();
    setBorrador((prev) => fn(prev ?? base));
  };
  const editarFila = (key: string, fn: (f: Fila) => Fila) =>
    editar((h) => ({ ...h, filas: h.filas.map((f) => (f.key === key ? fn(f) : f)) }));

  const valorBase = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of base.filas) for (const [k, v] of Object.entries(f.precios)) m.set(`${f.key}|${k}`, v);
    return m;
  }, [base]);

  function agregarColumna() {
    const clave = claveNueva('c');
    editar((h) => ({
      columnas: [...h.columnas, { clave, nombre: `Columna ${h.columnas.length + 1}`, dias: [], meses: [], respaldo: null }],
      filas: h.filas.map((f) => ({ ...f, precios: { ...f.precios, [clave]: '' } })),
    }));
  }

  function borrarColumna(clave: string) {
    editar((h) => ({
      columnas: h.columnas
        .filter((c) => c.clave !== clave)
        .map((c) => (c.respaldo === clave ? { ...c, respaldo: null } : c)),
      filas: h.filas.map((f) => {
        const { [clave]: _fuera, ...resto } = f.precios;
        return { ...f, precios: resto };
      }),
    }));
  }

  function agregarRango(grupo: Fila[]) {
    const ultimo = grupo[grupo.length - 1]!;
    const desde = (Number(ultimo.max) || Number(ultimo.min) || 0) + 1;
    editar((h) => ({
      ...h,
      filas: [
        ...h.filas,
        {
          key: claveNueva('r'),
          spaceId: ultimo.spaceId,
          espacio: ultimo.espacio,
          tipo: ultimo.tipo,
          min: String(desde),
          max: '',
          precios: Object.fromEntries(h.columnas.map((c) => [c.clave, ''])),
        },
      ],
    }));
  }

  function agregarSalon(tipo: 'dia' | 'plano', spaceId: string) {
    const e = espacios.find((x) => x.id === spaceId);
    if (!e) return;
    editar((h) => ({
      ...h,
      filas: [
        ...h.filas,
        {
          key: claveNueva('r'),
          spaceId,
          espacio: e.nombre,
          tipo,
          min: '1',
          max: '',
          precios: Object.fromEntries(h.columnas.map((c) => [c.clave, ''])),
        },
      ],
    }));
  }

  async function guardar() {
    const bien = await correr(() => onGuardar(aPayload(hoja)), 'Renta guardada.');
    if (bien) setBorrador(null);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-charcoal-soft">
        Escribe directo en la celda; <kbd className="rounded bg-cream-200 px-1 text-xs">Enter</kbd> y las flechas
        te mueven, y puedes pegar un bloque copiado de Excel. Una celda <strong>vacía</strong> es "sin precio": ese
        día no se ofrece (o se cobra como la columna que diga su encabezado). Toca la regla debajo del nombre de
        una columna para elegir sus días y meses.
      </p>
      {bloqueada && (
        <p className="rounded-lg bg-cream-200/60 px-3 py-2 text-sm text-ink">
          Este catálogo ya lo usan {enUso} evento{enUso === 1 ? '' : 's'}: aquí solo se cambian{' '}
          <strong>precios y nombres de columna</strong>. Para agregar o quitar columnas o rangos, crea un catálogo
          nuevo copiando este.
        </p>
      )}

      {TIPOS.map(({ tipo, titulo }) => {
        const filas = ordenar(hoja.filas.filter((f) => f.tipo === tipo));
        if (filas.length === 0 && (tipo === 'plano' || bloqueada)) return null;
        const bandas = bandasDeGrupo(filas.map((f) => f.spaceId));
        const presentes = new Set(filas.map((f) => f.spaceId));
        const faltan = espacios.filter((e) => e.activo && !presentes.has(e.id));
        return (
          <section key={tipo} className="space-y-2">
            <h4 className="font-display text-base text-ink">{titulo}</h4>
            <div className="overflow-x-auto rounded-xl border border-cream-300 bg-white/70 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
              <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
                <thead className="bg-cream-100/80">
                  <tr className="align-top [&>th]:border-b [&>th]:border-cream-300">
                    <th className="sticky left-0 z-10 w-28 min-w-[7rem] bg-cream-100 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-charcoal-soft">
                      Salón
                    </th>
                    <th className="sticky left-28 z-10 w-32 min-w-[8rem] bg-cream-100 px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-charcoal-soft shadow-[1px_0_0_var(--color-cream-300)]">
                      Invitados
                    </th>
                    {hoja.columnas.map((c) => (
                      <th key={c.clave} className="min-w-[8.5rem] border-l border-cream-200 px-1.5 py-1.5 text-left font-medium">
                        <EncabezadoColumna
                          columna={c}
                          otras={hoja.columnas.filter((o) => o.clave !== c.clave)}
                          bloqueada={bloqueada}
                          puedeBorrar={!bloqueada && hoja.columnas.length > 1}
                          onCambiar={(nueva) =>
                            editar((h) => ({ ...h, columnas: h.columnas.map((x) => (x.clave === c.clave ? nueva : x)) }))
                          }
                          onBorrar={() => borrarColumna(c.clave)}
                        />
                      </th>
                    ))}
                    <th className="w-10 border-l border-cream-200 px-1 py-2">
                      {!bloqueada && (
                        <button
                          type="button"
                          onClick={agregarColumna}
                          title="Agregar columna"
                          aria-label="Agregar columna"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-gold hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
                        >
                          <Plus size={16} />
                        </button>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => {
                    const primero = f.spaceId !== filas[i - 1]?.spaceId;
                    const ultimo = f.spaceId !== filas[i + 1]?.spaceId;
                    const grupo = filas.filter((x) => x.spaceId === f.spaceId);
                    return (
                      <tr
                        key={f.key}
                        className={`group ${bandas[i] ? 'bg-cream-100' : 'bg-white'} [&>td]:border-t ${primero ? '[&>td]:border-cream-300' : '[&>td]:border-cream-200/70'}`}
                      >
                        <td className={`sticky left-0 z-10 w-28 min-w-[7rem] px-3 py-1 align-top ${bandas[i] ? 'bg-cream-100' : 'bg-white'}`}>
                          {primero && (
                            <span className="font-medium text-ink" title={f.espacio}>
                              {nombreCortoEspacio(f.espacio)}
                            </span>
                          )}
                          {ultimo && !bloqueada && (
                            <button
                              type="button"
                              onClick={() => agregarRango(grupo)}
                              className="mt-0.5 flex items-center gap-1 text-[0.68rem] text-gold opacity-0 transition-opacity hover:underline focus:opacity-100 group-hover:opacity-100"
                            >
                              <Plus size={11} /> rango
                            </button>
                          )}
                        </td>
                        <td className={`sticky left-28 z-10 w-32 min-w-[8rem] px-2 py-1 shadow-[1px_0_0_var(--color-cream-300)] ${bandas[i] ? 'bg-cream-100' : 'bg-white'}`}>
                          <div className="flex items-center gap-1 text-charcoal-soft">
                            <CampoRango
                              valor={f.min}
                              bloqueado={bloqueada}
                              etiqueta={`${f.espacio}: desde`}
                              onCambiar={(v) => editarFila(f.key, (x) => ({ ...x, min: v }))}
                            />
                            <span>–</span>
                            <CampoRango
                              valor={f.max}
                              bloqueado={bloqueada}
                              placeholder="∞"
                              etiqueta={`${f.espacio}: hasta`}
                              onCambiar={(v) => editarFila(f.key, (x) => ({ ...x, max: v }))}
                            />
                          </div>
                        </td>
                        {hoja.columnas.map((c, j) => {
                          const k = `${f.key}|${c.clave}`;
                          const valor = f.precios[c.clave] ?? '';
                          const cambiada = f.id ? (valorBase.get(k) ?? '') !== valor : valor !== '';
                          return (
                            <td key={c.clave} className="border-l border-cream-200/70 p-0">
                              <Celda
                                id={`celda-${tipo}-${i}-${j}`}
                                valor={valor}
                                mala={rev.celdasMalas.has(k)}
                                cambiada={cambiada}
                                etiqueta={`${f.espacio} ${f.min}–${f.max || '∞'} ${c.nombre}`}
                                onCambiar={(v) => editarFila(f.key, (x) => ({ ...x, precios: { ...x.precios, [c.clave]: v } }))}
                                onMover={(df, dc) => document.getElementById(`celda-${tipo}-${i + df}-${j + dc}`)?.focus()}
                                onPegar={(texto) => editar((h) => pegarBloque(h, filas, i, j, texto))}
                              />
                            </td>
                          );
                        })}
                        <td className="border-l border-cream-200/70 px-1 text-center">
                          {!bloqueada && (
                            <button
                              type="button"
                              onClick={() => editar((h) => ({ ...h, filas: h.filas.filter((x) => x.key !== f.key) }))}
                              title="Quitar este rango"
                              aria-label={`Quitar ${f.espacio} ${f.min}–${f.max || '∞'}`}
                              className="flex h-6 w-6 items-center justify-center rounded-full text-charcoal-soft opacity-0 transition-opacity hover:bg-wine/10 hover:text-wine focus:opacity-100 group-hover:opacity-100"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!bloqueada && faltan.length > 0 && (
              <label className="inline-flex items-center gap-2 text-xs text-charcoal-soft">
                <Plus size={13} className="text-gold" />
                <select
                  value=""
                  onChange={(e) => agregarSalon(tipo, e.target.value)}
                  className="rounded-lg border border-cream-300 bg-white px-2 py-1 text-xs text-ink focus:border-gold focus:outline-none"
                >
                  <option value="">Agregar salón…</option>
                  {faltan.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        );
      })}

      {(rev.errores.length > 0 || rev.avisos.length > 0) && (
        <ul className="space-y-1 text-xs">
          {rev.errores.map((e) => (
            <li key={e} className="text-wine">
              {e}
            </li>
          ))}
          {rev.avisos.map((a) => (
            <li key={a} className="text-charcoal-soft">
              {a}
            </li>
          ))}
        </ul>
      )}

      <BarraGuardar
        cambios={rev.errores.length ? 0 : cambios}
        pendiente={pendiente}
        error={error}
        ok={ok}
        onGuardar={() => void guardar()}
        onDescartar={() => {
          setBorrador(null);
          limpiar();
        }}
        etiqueta="Guardar renta"
        unidad="cambio"
      />
    </div>
  );
}

/** Celdas, rangos y columnas distintas de lo guardado. */
function contarCambios(base: Hoja, hoja: Hoja): number {
  if (base === hoja) return 0;
  let n = 0;
  const porId = new Map(base.filas.map((f) => [f.key, f]));
  for (const f of hoja.filas) {
    const b = porId.get(f.key);
    if (!b) {
      n++;
      continue;
    }
    if (b.min !== f.min || b.max !== f.max) n++;
    for (const c of hoja.columnas) if ((b.precios[c.clave] ?? '') !== (f.precios[c.clave] ?? '')) n++;
  }
  n += base.filas.filter((b) => !hoja.filas.some((f) => f.key === b.key)).length;
  if (JSON.stringify(base.columnas) !== JSON.stringify(hoja.columnas)) n++;
  return n;
}

function CampoRango({
  valor,
  bloqueado,
  placeholder,
  etiqueta,
  onCambiar,
}: {
  valor: string;
  bloqueado: boolean;
  placeholder?: string;
  etiqueta: string;
  onCambiar: (v: string) => void;
}) {
  return (
    <input
      value={valor}
      disabled={bloqueado}
      inputMode="numeric"
      placeholder={placeholder}
      aria-label={etiqueta}
      onChange={(e) => onCambiar(e.target.value.replace(/\D/g, ''))}
      className="w-12 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-right text-sm text-charcoal hover:border-cream-300 focus:border-gold focus:bg-white focus:outline-none disabled:hover:border-transparent"
    />
  );
}

/** Una celda de precio: muestra "42,000" y al enfocarla se edita el número limpio. */
function Celda({
  id,
  valor,
  mala,
  cambiada,
  etiqueta,
  onCambiar,
  onMover,
  onPegar,
}: {
  id: string;
  valor: string;
  mala: boolean;
  cambiada: boolean;
  etiqueta: string;
  onCambiar: (v: string) => void;
  onMover: (filas: number, columnas: number) => void;
  onPegar: (texto: string) => void;
}) {
  const [enfocada, setEnfocada] = useState(false);
  const n = leerPesos(valor);
  const mostrado = enfocada || n == null ? valor : `$${miles.format(n)}`;

  function teclas(e: KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const alInicio = el.selectionStart === 0 && el.selectionEnd === 0;
    const alFinal = el.selectionStart === el.value.length;
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      onMover(e.shiftKey && e.key === 'Enter' ? -1 : 1, 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onMover(-1, 0);
    } else if (e.key === 'ArrowLeft' && alInicio) {
      e.preventDefault();
      onMover(0, -1);
    } else if (e.key === 'ArrowRight' && alFinal) {
      e.preventDefault();
      onMover(0, 1);
    }
  }

  function pegar(e: ClipboardEvent<HTMLInputElement>) {
    const texto = e.clipboardData.getData('text');
    if (/[\t\n]/.test(texto.trim())) {
      e.preventDefault();
      onPegar(texto);
    }
  }

  return (
    <input
      id={id}
      value={mostrado}
      inputMode="numeric"
      placeholder="—"
      aria-label={etiqueta}
      aria-invalid={mala || undefined}
      onFocus={(e) => {
        setEnfocada(true);
        requestAnimationFrame(() => e.target.select());
      }}
      onBlur={() => setEnfocada(false)}
      onChange={(e) => onCambiar(e.target.value)}
      onKeyDown={teclas}
      onPaste={pegar}
      className={`block h-9 w-full min-w-[8rem] border-0 px-2.5 text-right text-sm outline-none transition-colors placeholder:text-charcoal-soft/40 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-gold ${
        mala ? 'bg-wine/10 text-wine' : cambiada ? 'bg-gold/15 text-ink' : 'bg-transparent text-ink'
      }`}
    />
  );
}
