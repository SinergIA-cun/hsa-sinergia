import { useMemo, useState } from 'react';
import { formatMXN } from '../../../lib/money.ts';
import { TextInput } from '../../ui.tsx';
import type { RentaRenglon } from '../../../lib/types.ts';
import { BarraGuardar, useGuardar } from './guardado.tsx';

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
  viernes: number;
  viernesEspecial: number;
  sabado: number;
  domAJue: number;
}

/** Lo que se está escribiendo, por renglón. Cadenas, no números: un input vacío no es 0. */
type Borrador = Record<string, Record<Campo, string>>;

const deRenglon = (r: RentaRenglon): Record<Campo, string> => ({
  viernes: String(r.viernes),
  viernesEspecial: String(r.viernesEspecial),
  sabado: String(r.sabado),
  domAJue: String(r.domAJue),
});

/** Un precio válido: entero de pesos, no negativo. Postgres TRUNCA los flotantes. */
function aPrecio(v: string): number | null {
  const n = Number(v);
  if (v.trim() === '' || Number.isNaN(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

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
      if (numeros.some((n) => n === null)) continue; // inválido: no se manda
      const distinto = CAMPOS.some((c, i) => numeros[i] !== base[c]);
      if (!distinto) continue;
      out.push({
        id,
        viernes: numeros[0]!,
        viernesEspecial: numeros[1]!,
        sabado: numeros[2]!,
        domAJue: numeros[3]!,
      });
    }
    return out;
  }, [borrador, porId]);

  const hayInvalidos = Object.entries(borrador).some(([, v]) =>
    CAMPOS.some((c) => aPrecio(v[c]) === null),
  );

  function editar(r: RentaRenglon, campo: Campo, valor: string) {
    limpiar();
    setInvalido('');
    setBorrador((prev) => ({
      ...prev,
      [r.id]: { ...(prev[r.id] ?? deRenglon(r)), [campo]: valor },
    }));
  }

  async function guardar() {
    if (hayInvalidos) {
      setInvalido('Hay precios vacíos o con decimales. Usa pesos enteros, sin centavos.');
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

      {porTipo.map((g) => (
        <div key={g.tipo} className="space-y-1.5">
          <h4 className="font-display text-base text-ink">{g.titulo}</h4>
          {g.tipo === 'plano' && (
            <p className="text-xs text-charcoal-soft">
              La renta plana cobra lo mismo todos los días: los cuatro precios de un renglón deberían
              coincidir.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-cream-300 text-left text-xs uppercase tracking-wide text-charcoal-soft">
                  <th className="py-1.5 pr-3 font-medium">Espacio</th>
                  <th className="py-1.5 pr-3 font-medium">Invitados</th>
                  {CAMPOS.map((c) => (
                    <th key={c} className="py-1.5 pr-3 font-medium">
                      {ETIQUETA[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.renglones.map((r) => (
                  <Renglon
                    key={r.id}
                    renglon={r}
                    valores={borrador[r.id] ?? deRenglon(r)}
                    tocado={borrador[r.id] !== undefined}
                    onEditar={(campo, valor) => editar(r, campo, valor)}
                  />
                ))}
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
  onEditar,
}: {
  renglon: RentaRenglon;
  valores: Record<Campo, string>;
  tocado: boolean;
  onEditar: (campo: Campo, valor: string) => void;
}) {
  const desigual =
    renglon.tipo === 'plano' && new Set(CAMPOS.map((c) => valores[c])).size > 1;

  return (
    <tr className={`border-b border-cream-200/70 ${tocado ? 'bg-gold/5' : ''}`}>
      <td className="py-1.5 pr-3 text-ink">{renglon.espacio}</td>
      <td className="py-1.5 pr-3 text-charcoal-soft">
        {rango(renglon)}
        {desigual && (
          <span className="ml-1 text-wine" title="En renta plana los cuatro precios deberían coincidir">
            ≠
          </span>
        )}
      </td>
      {CAMPOS.map((campo) => {
        const malo = aPrecio(valores[campo]) === null;
        const cambiado = aPrecio(valores[campo]) !== renglon[campo];
        return (
          <td key={campo} className="py-1.5 pr-3">
            <TextInput
              type="number"
              min={0}
              step={1}
              aria-label={`${renglon.espacio} ${rango(renglon)} ${ETIQUETA[campo]}`}
              className={`w-28 px-2 py-1 text-sm ${malo ? 'border-wine' : ''}`}
              value={valores[campo]}
              onChange={(e) => onEditar(campo, e.target.value)}
            />
            {cambiado && !malo && (
              <span className="mt-0.5 block text-[0.65rem] text-charcoal-soft">
                antes {formatMXN(renglon[campo])}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
