import { useMemo, useState } from 'react';
import { formatMXN } from '../../../lib/money.ts';
import { MoneyInput } from '../../ui.tsx';
import type { RentaRenglon } from '../../../lib/types.ts';
import { BarraGuardar, useGuardar } from './guardado.tsx';
import { nombreCortoEspacio } from '@hsa/shared';
import { bandasDeGrupo } from '../../../lib/bandasDeGrupo.ts';

const CAMPOS = ['viernes', 'viernesEspecial', 'sabado', 'domAJue'] as const;
type Campo = (typeof CAMPOS)[number];

const ETIQUETA: Record<Campo, string> = {
  viernes: 'Viernes',
  viernesEspecial: 'Viernes especial',
  sabado: 'Sábado',
  domAJue: 'Dom a jue',
};

export interface RentaCambio {
  id: string;
  /** `null` = no aplica. */
  viernes: number | null;
  viernesEspecial: number | null;
  sabado: number | null;
  domAJue: number | null;
}

/**
 * "No aplica": ese día no se ofrece con esta renta. Antes se capturaba un cero, y
 * el cotizador lo cobraba como renta de $0 (decisión del dueño, 1-oct-2026).
 */
const NO_APLICA = 'no-aplica';

/** Lo que se está escribiendo, por renglón. Cadenas, no números: un input vacío no es 0. */
type Borrador = Record<string, Record<Campo, string>>;

const aTexto = (v: number | null): string => (v == null ? NO_APLICA : String(v));

const deRenglon = (r: RentaRenglon): Record<Campo, string> => ({
  viernes: aTexto(r.viernes),
  viernesEspecial: aTexto(r.viernesEspecial),
  sabado: aTexto(r.sabado),
  domAJue: aTexto(r.domAJue),
});

/**
 * Lo capturado en una celda: pesos enteros, `null` si no aplica, o `undefined`
 * si es inválido (vacío o con decimales). Prisma TRUNCA los flotantes.
 */
function aPrecio(v: string): number | null | undefined {
  if (v === NO_APLICA) return null;
  const n = Number(v);
  if (v.trim() === '' || Number.isNaN(n) || !Number.isInteger(n) || n < 0) return undefined;
  return n;
}

/** Qué pasa cuando una columna no aplica, dicho para quien captura. */
const EFECTO_NO_APLICA: Record<Campo, string> = {
  viernes: 'No se ofrece en viernes (tampoco el viernes especial si también está apagado).',
  viernesEspecial: 'El viernes especial se cobra como viernes normal.',
  sabado: 'No se ofrece en sábado.',
  domAJue: 'No se ofrece de domingo a jueves.',
};

const rango = (r: RentaRenglon) => `${r.min}–${r.max ?? '∞'}`;

/**
 * La matriz de renta: un renglón por espacio y rango de invitados, con sus
 * cuatro precios.
 *
 * Solo se editan los PRECIOS. Los rangos (`min`/`max`) no se agregan ni se
 * quitan: un hueco entre rangos hace que el motor lance "no tiene rango de renta
 * para N invitados" la primera vez que alguien capture ese número, meses
 * después. Esa puerta se queda cerrada por decisión del dueño.
 *
 * Al guardar se mandan SOLO los renglones que cambiaron, no los 37: la bitácora
 * tiene que poder decir qué se cambió, y "se editó la renta" no dice nada.
 */
export function RentaSeccion({
  renta,
  onGuardar,
}: {
  renta: RentaRenglon[];
  onGuardar: (cambios: RentaCambio[]) => Promise<unknown>;
}) {
  const [borrador, setBorrador] = useState<Borrador>({});
  const { correr, pendiente, error, ok, limpiar } = useGuardar('No se pudo guardar la renta.');
  const [invalido, setInvalido] = useState('');

  const porId = useMemo(() => new Map(renta.map((r) => [r.id, r])), [renta]);

  /** Los renglones cuyo borrador difiere de lo guardado. */
  const cambios = useMemo(() => {
    const out: RentaCambio[] = [];
    for (const [id, valores] of Object.entries(borrador)) {
      const base = porId.get(id);
      if (!base) continue;
      const numeros = CAMPOS.map((c) => aPrecio(valores[c]));
      if (numeros.some((n) => n === undefined)) continue; // inválido: no se manda
      const distinto = CAMPOS.some((c, i) => numeros[i] !== base[c]);
      if (!distinto) continue;
      out.push({
        id,
        viernes: numeros[0] ?? null,
        viernesEspecial: numeros[1] ?? null,
        sabado: numeros[2] ?? null,
        domAJue: numeros[3] ?? null,
      });
    }
    return out;
  }, [borrador, porId]);

  const hayInvalidos = Object.entries(borrador).some(([, v]) =>
    CAMPOS.some((c) => aPrecio(v[c]) === undefined),
  );

  function editar(r: RentaRenglon, campo: Campo, valor: string) {
    limpiar();
    setInvalido('');
    setBorrador((prev) => ({
      ...prev,
      [r.id]: { ...(prev[r.id] ?? deRenglon(r)), [campo]: valor },
    }));
  }

  /**
   * Apaga o prende una columna entera de una tabla. Al prenderla, cada celda
   * vuelve a su precio guardado (si tenía) o queda vacía para capturarlo.
   */
  function alternarColumna(renglones: RentaRenglon[], campo: Campo, apagar: boolean) {
    limpiar();
    setInvalido('');
    setBorrador((prev) => {
      const next = { ...prev };
      for (const r of renglones) {
        const actual = next[r.id] ?? deRenglon(r);
        const guardado = r[campo];
        next[r.id] = { ...actual, [campo]: apagar ? NO_APLICA : guardado == null ? '' : String(guardado) };
      }
      return next;
    });
  }

  async function guardar() {
    if (hayInvalidos) {
      setInvalido('Hay precios vacíos o con decimales. Usa pesos enteros, sin centavos, o márcalos "No aplica".');
      return;
    }
    setInvalido('');
    const enviados = cambios;
    const bien = await correr(
      () => onGuardar(enviados),
      `${enviados.length} renglón${enviados.length === 1 ? '' : 'es'} guardado${enviados.length === 1 ? '' : 's'}.`,
    );
    if (bien) setBorrador({});
  }

  const porTipo = [
    { tipo: 'dia', titulo: 'Renta por tipo de día', renglones: renta.filter((r) => r.tipo === 'dia') },
    {
      tipo: 'plano',
      titulo: 'Renta plana (Team Building)',
      renglones: renta.filter((r) => r.tipo === 'plano'),
    },
  ].filter((g) => g.renglones.length > 0);

  if (renta.length === 0) {
    return (
      <p className="text-sm text-wine">
        Este catálogo no tiene renglones de renta. Sin ellos, el motor lanza “no tiene rango de renta
        para N invitados” al primer intento de cotizar: clona un catálogo que sí los tenga.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-charcoal-soft">
        Solo se editan los precios. Los rangos de invitados no se agregan ni se quitan: un hueco
        entre rangos deja sin precio a ese número de invitados y el cotizador revienta al capturarlo.
      </p>
      <p className="rounded-lg bg-cream-200/60 px-3 py-2 text-sm text-ink">
        <strong>No aplica</strong> apaga un precio sin dejarlo en cero. El <strong>viernes especial</strong>{' '}
        apagado se cobra como viernes normal; cualquier otro día apagado <strong>no se ofrece</strong>: el
        cotizador avisa en vez de cobrar $0. Se apaga por celda, o la columna entera desde su encabezado.
      </p>

      {porTipo.map((g) => (
        <div key={g.tipo} className="space-y-1.5">
          <h4 className="font-display text-base text-ink">{g.titulo}</h4>
          {g.tipo === 'plano' && (
            <p className="text-xs text-charcoal-soft">
              La renta plana cobra lo mismo todos los días que se ofrece: los precios de un renglón que
              sí aplican deberían coincidir.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-cream-300 text-left text-xs uppercase tracking-wide text-charcoal-soft">
                  <th className="py-1.5 pr-3 font-medium">Espacio</th>
                  <th className="py-1.5 pr-3 font-medium">Invitados</th>
                  {CAMPOS.map((c) => {
                    const apagada = g.renglones.every(
                      (r) => (borrador[r.id] ?? deRenglon(r))[c] === NO_APLICA,
                    );
                    return (
                      <th key={c} className="py-1.5 pr-3 align-bottom font-medium">
                        <span className="block">{ETIQUETA[c]}</span>
                        <button
                          type="button"
                          onClick={() => alternarColumna(g.renglones, c, !apagada)}
                          title={apagada ? 'Volver a ofrecer esta columna' : EFECTO_NO_APLICA[c]}
                          className="mt-0.5 text-[0.65rem] font-semibold normal-case tracking-normal text-gold hover:underline"
                        >
                          {apagada ? 'Activar columna' : 'Columna: no aplica'}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Las bandas se calculan por tabla y no de una vez sobre toda
                    la renta: cada tabla arranca su propio conteo, para que la
                    de renta plana no herede el color con el que quedó la de
                    arriba. */}
                {(() => {
                  const bandas = bandasDeGrupo(g.renglones.map((r) => r.spaceId));
                  return g.renglones.map((r, i) => (
                    <Renglon
                      key={r.id}
                      renglon={r}
                      valores={borrador[r.id] ?? deRenglon(r)}
                      tocado={borrador[r.id] !== undefined}
                      banda={bandas[i]!}
                      primeroDelGrupo={r.spaceId !== g.renglones[i - 1]?.spaceId}
                      onEditar={(campo, valor) => editar(r, campo, valor)}
                    />
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <BarraGuardar
        cambios={cambios.length}
        pendiente={pendiente}
        error={invalido || error}
        ok={ok}
        onGuardar={() => void guardar()}
        onDescartar={() => {
          setBorrador({});
          setInvalido('');
          limpiar();
        }}
        etiqueta="Guardar renta"
        unidad="renglón"
      />
    </div>
  );
}

function Renglon({
  renglon,
  valores,
  tocado,
  banda,
  primeroDelGrupo,
  onEditar,
}: {
  renglon: RentaRenglon;
  valores: Record<Campo, string>;
  tocado: boolean;
  banda: boolean;
  primeroDelGrupo: boolean;
  onEditar: (campo: Campo, valor: string) => void;
}) {
  // En renta plana los días que SÍ se ofrecen cobran lo mismo; los que no
  // aplican no cuentan (es normal apagar viernes y sábado).
  const desigual =
    renglon.tipo === 'plano' &&
    new Set(CAMPOS.map((c) => valores[c]).filter((v) => v !== NO_APLICA)).size > 1;

  /*
   * El fondo del renglón, en orden de prioridad.
   *
   * Un renglón TOCADO gana siempre: es dinero sin guardar, y perder de vista
   * cuál se movió es peor que perder de vista en qué bloque va. Por eso el
   * dorado es más fuerte que la banda y se pinta encima de las dos.
   */
  const fondo = tocado ? 'bg-gold/15' : banda ? 'bg-cream-200/55' : '';

  return (
    <tr
      className={`${fondo} ${
        // Una línea más marcada donde empieza otro salón: el corte entre bloques
        // se ve aunque dos bloques seguidos caigan en el mismo tono.
        primeroDelGrupo ? 'border-t border-cream-300' : ''
      } border-b border-cream-200/70`}
    >
      <td className="py-1.5 pr-3">
        <span
          className="font-medium text-ink"
          /* El nombre completo se conserva al pasar el cursor: la abreviación es
             para leer rápido, no para esconder cuál es el salón. */
          title={renglon.espacio}
        >
          {nombreCortoEspacio(renglon.espacio)}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-charcoal-soft">
        {rango(renglon)}
        {desigual && (
          <span className="ml-1 text-wine" title="En renta plana los precios que sí aplican deberían coincidir">
            ≠
          </span>
        )}
      </td>
      {CAMPOS.map((campo) => {
        const leido = aPrecio(valores[campo]);
        const malo = leido === undefined;
        const noAplica = leido === null;
        const cambiado = !malo && leido !== renglon[campo];
        const guardado = renglon[campo];
        const antes = guardado == null ? 'no aplicaba' : formatMXN(guardado);
        const etiqueta = `${renglon.espacio} ${rango(renglon)} ${ETIQUETA[campo]}`;
        return (
          <td key={campo} className="py-1.5 pr-3 align-top">
            {noAplica ? (
              <button
                type="button"
                onClick={() => onEditar(campo, guardado == null ? '' : String(guardado))}
                title={`${EFECTO_NO_APLICA[campo]} Clic para volver a ofrecerlo.`}
                aria-label={`${etiqueta}: no aplica. Volver a ofrecerlo`}
                className="w-28 rounded-lg border border-dashed border-ink/25 bg-ink/[0.03] px-2 py-1 text-left text-xs font-medium text-charcoal-soft hover:border-gold hover:text-ink"
              >
                No aplica
              </button>
            ) : (
              <>
                <MoneyInput
                  aria-label={etiqueta}
                  className={`w-28 px-2 py-1 text-sm ${malo ? 'border-wine' : ''}`}
                  value={valores[campo]}
                  onValue={(v) => onEditar(campo, v)}
                />
                <button
                  type="button"
                  onClick={() => onEditar(campo, NO_APLICA)}
                  title={EFECTO_NO_APLICA[campo]}
                  className="mt-0.5 block text-[0.65rem] text-charcoal-soft hover:text-wine hover:underline"
                >
                  No aplica
                </button>
              </>
            )}
            {cambiado && (
              <span className="mt-0.5 block text-[0.65rem] text-charcoal-soft">antes {antes}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
