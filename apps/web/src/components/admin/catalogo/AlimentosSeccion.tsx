import { useState, type FormEvent } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button, Field, SelectInput, TextInput } from '../../ui.tsx';
import type { FoodPackageBracket, PaqueteCatalogo } from '../../../lib/types.ts';
import { ConfirmDelete } from '../shared.tsx';
import { BarraGuardar, useGuardar } from './guardado.tsx';

/** Un rango en captura: cadenas, porque un campo vacío no es 0 ni es "sin tope". */
type BracketBorrador = { min: string; max: string; pricePerPerson: string };

export interface PaquetePatch {
  nombre?: string;
  eventTypeId?: string;
  ivaIncluido?: boolean;
  brackets?: FoodPackageBracket[];
}

export interface PaqueteNuevo {
  nombre: string;
  eventTypeId: string;
  ivaIncluido: boolean;
  brackets: FoodPackageBracket[];
}

const aBorrador = (b: FoodPackageBracket): BracketBorrador => ({
  min: String(b.min),
  max: b.max === null ? '' : String(b.max),
  pricePerPerson: String(b.pricePerPerson),
});

/**
 * Convierte los rangos capturados a números, o `null` si alguno no sirve.
 *
 * `max` vacío es `null` a propósito: es el rango ABIERTO, el que cubre de ahí
 * para arriba. Solo el último debería quedar así, y de eso se encarga el
 * servidor: la validación de traslapes y huecos es una regla de negocio y vive
 * en `@hsa/shared`, no duplicada aquí.
 */
function aBrackets(bs: BracketBorrador[]): FoodPackageBracket[] | null {
  const out: FoodPackageBracket[] = [];
  for (const b of bs) {
    const min = Number(b.min);
    const precio = Number(b.pricePerPerson);
    const max = b.max.trim() === '' ? null : Number(b.max);
    if (b.min.trim() === '' || !Number.isInteger(min) || min < 1) return null;
    if (max !== null && (!Number.isInteger(max) || max < min)) return null;
    if (b.pricePerPerson.trim() === '' || !Number.isInteger(precio) || precio < 0) return null;
    out.push({ min, max, pricePerPerson: precio });
  }
  return out.length > 0 ? out : null;
}

/**
 * Los paquetes de alimentos del catálogo, por tipo de evento, con sus rangos de
 * precio por persona.
 *
 * Un paquete SIN rangos es un paquete sin precio: el motor lanza "no tiene rango
 * para N invitados" la primera vez que alguien lo elija. Por eso los rangos se
 * mandan siempre completos y el servidor los valida enteros —traslapes y huecos
 * incluidos— en vez de renglón por renglón.
 */
export function AlimentosSeccion({
  paquetes,
  eventTypes,
  onCrear,
  onEditar,
  onBorrar,
}: {
  paquetes: PaqueteCatalogo[];
  eventTypes: { id: string; nombre: string }[];
  onCrear: (datos: PaqueteNuevo) => Promise<unknown>;
  onEditar: (id: string, datos: PaquetePatch) => Promise<unknown>;
  onBorrar: (id: string) => Promise<unknown>;
}) {
  const nombrePorTipo = new Map(eventTypes.map((t) => [t.id, t.nombre]));
  const porTipo = eventTypes
    .map((t) => ({ tipo: t, paquetes: paquetes.filter((p) => p.eventTypeId === t.id) }))
    .filter((g) => g.paquetes.length > 0);
  const huerfanos = paquetes.filter((p) => !nombrePorTipo.has(p.eventTypeId));

  return (
    <div className="space-y-6">
      {paquetes.length === 0 && (
        <p className="text-sm text-charcoal-soft">
          Este catálogo todavía no tiene paquetes de alimentos.
        </p>
      )}
      {[...porTipo, ...(huerfanos.length > 0 ? [{ tipo: { id: '', nombre: 'Sin tipo de evento' }, paquetes: huerfanos }] : [])].map(
        (g) => (
          <div key={g.tipo.id || 'huerfanos'} className="space-y-3">
            <h4 className="font-display text-base text-ink">{g.tipo.nombre}</h4>
            {g.paquetes.map((p) => (
              <PaqueteEditor
                key={p.id}
                paquete={p}
                eventTypes={eventTypes}
                onEditar={(datos) => onEditar(p.id, datos)}
                onBorrar={() => onBorrar(p.id)}
              />
            ))}
          </div>
        ),
      )}
      <NuevoPaquete eventTypes={eventTypes} onCrear={onCrear} />
    </div>
  );
}

function PaqueteEditor({
  paquete,
  eventTypes,
  onEditar,
  onBorrar,
}: {
  paquete: PaqueteCatalogo;
  eventTypes: { id: string; nombre: string }[];
  onEditar: (datos: PaquetePatch) => Promise<unknown>;
  onBorrar: () => Promise<unknown>;
}) {
  const [nombre, setNombre] = useState(paquete.nombre);
  const [eventTypeId, setEventTypeId] = useState(paquete.eventTypeId);
  const [ivaIncluido, setIvaIncluido] = useState(paquete.ivaIncluido);
  const [brackets, setBrackets] = useState<BracketBorrador[]>(paquete.brackets.map(aBorrador));
  const [invalido, setInvalido] = useState('');
  const { correr, pendiente, error, ok, limpiar } = useGuardar('No se pudo guardar el paquete.');

  const numeros = aBrackets(brackets);
  const cambiado =
    nombre.trim() !== paquete.nombre ||
    eventTypeId !== paquete.eventTypeId ||
    ivaIncluido !== paquete.ivaIncluido ||
    JSON.stringify(numeros) !== JSON.stringify(paquete.brackets);

  function descartar() {
    setNombre(paquete.nombre);
    setEventTypeId(paquete.eventTypeId);
    setIvaIncluido(paquete.ivaIncluido);
    setBrackets(paquete.brackets.map(aBorrador));
    setInvalido('');
    limpiar();
  }

  async function guardar() {
    if (!nombre.trim()) {
      setInvalido('El paquete necesita nombre.');
      return;
    }
    if (!numeros) {
      setInvalido(
        'Revisa los rangos: mínimo desde 1, tope vacío solo en el último, y precio en pesos enteros.',
      );
      return;
    }
    setInvalido('');
    await correr(
      () => onEditar({ nombre: nombre.trim(), eventTypeId, ivaIncluido, brackets: numeros }),
      'Paquete guardado.',
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-cream-300 bg-white/60 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
          <Field label="Nombre">
            <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Field>
          <Field label="Tipo de evento">
            <SelectInput value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)}>
              {eventTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <ConfirmDelete onConfirm={onBorrar} label="Borrar paquete" />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={ivaIncluido}
          onChange={(e) => setIvaIncluido(e.target.checked)}
          className="size-4 accent-gold"
        />
        El precio por persona ya trae IVA
      </label>

      <BracketsTabla brackets={brackets} onChange={setBrackets} />

      <BarraGuardar
        cambios={cambiado ? 1 : 0}
        pendiente={pendiente}
        error={invalido || error}
        ok={ok}
        onGuardar={() => void guardar()}
        onDescartar={descartar}
        etiqueta="Guardar paquete"
      />
    </div>
  );
}

function BracketsTabla({
  brackets,
  onChange,
}: {
  brackets: BracketBorrador[];
  onChange: (bs: BracketBorrador[]) => void;
}) {
  function editar(i: number, campo: keyof BracketBorrador, valor: string) {
    onChange(brackets.map((b, j) => (i === j ? { ...b, [campo]: valor } : b)));
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
        Precio por persona, por rango de invitados
      </p>
      <p className="text-xs text-charcoal-soft">
        Los rangos no pueden traslaparse ni dejar huecos. Deja vacío el tope del último para que
        cubra de ahí para arriba.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-charcoal-soft">
            <th className="pr-2 font-medium">Desde</th>
            <th className="pr-2 font-medium">Hasta</th>
            <th className="pr-2 font-medium">$ / persona</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {brackets.map((b, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <TextInput
                  type="number"
                  min={1}
                  step={1}
                  aria-label={`Rango ${i + 1} desde`}
                  className="w-24 px-2 py-1 text-sm"
                  value={b.min}
                  onChange={(e) => editar(i, 'min', e.target.value)}
                />
              </td>
              <td className="py-1 pr-2">
                <TextInput
                  type="number"
                  min={1}
                  step={1}
                  aria-label={`Rango ${i + 1} hasta`}
                  placeholder="sin tope"
                  className="w-24 px-2 py-1 text-sm"
                  value={b.max}
                  onChange={(e) => editar(i, 'max', e.target.value)}
                />
              </td>
              <td className="py-1 pr-2">
                <TextInput
                  type="number"
                  min={0}
                  step={1}
                  aria-label={`Rango ${i + 1} precio por persona`}
                  className="w-28 px-2 py-1 text-sm"
                  value={b.pricePerPerson}
                  onChange={(e) => editar(i, 'pricePerPerson', e.target.value)}
                />
              </td>
              <td className="py-1">
                {brackets.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2 py-1 text-xs text-wine hover:bg-wine/10"
                    aria-label={`Quitar rango ${i + 1}`}
                    onClick={() => onChange(brackets.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        type="button"
        variant="outline"
        className="px-2.5 py-1.5 text-xs"
        onClick={() =>
          onChange([...brackets, { min: '', max: '', pricePerPerson: '' }])
        }
      >
        <Plus size={13} /> Agregar rango
      </Button>
    </div>
  );
}

function NuevoPaquete({
  eventTypes,
  onCrear,
}: {
  eventTypes: { id: string; nombre: string }[];
  onCrear: (datos: PaqueteNuevo) => Promise<unknown>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [eventTypeId, setEventTypeId] = useState(eventTypes[0]?.id ?? '');
  const [ivaIncluido, setIvaIncluido] = useState(false);
  const [brackets, setBrackets] = useState<BracketBorrador[]>([
    { min: '1', max: '', pricePerPerson: '' },
  ]);
  const [invalido, setInvalido] = useState('');
  const { correr, pendiente, error, ok } = useGuardar('No se pudo crear el paquete.');

  if (!abierto) {
    return (
      <Button
        type="button"
        variant="outline"
        className="px-3 py-1.5 text-xs"
        onClick={() => setAbierto(true)}
      >
        <Plus size={13} /> Nuevo paquete de alimentos
      </Button>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const numeros = aBrackets(brackets);
    if (!nombre.trim() || !eventTypeId) {
      setInvalido('El paquete necesita nombre y tipo de evento.');
      return;
    }
    if (!numeros) {
      setInvalido('Un paquete sin rango con precio no se puede cotizar: captura al menos uno.');
      return;
    }
    setInvalido('');
    const bien = await correr(
      () => onCrear({ nombre: nombre.trim(), eventTypeId, ivaIncluido, brackets: numeros }),
      `“${nombre.trim()}” agregado.`,
    );
    if (bien) {
      setNombre('');
      setBrackets([{ min: '1', max: '', pricePerPerson: '' }]);
      setAbierto(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg bg-cream-100 p-4">
      <h4 className="font-display text-base text-ink">Nuevo paquete de alimentos</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre">
          <TextInput
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="3 Tiempos"
          />
        </Field>
        <Field label="Tipo de evento">
          <SelectInput value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)}>
            {eventTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={ivaIncluido}
          onChange={(e) => setIvaIncluido(e.target.checked)}
          className="size-4 accent-gold"
        />
        El precio por persona ya trae IVA
      </label>
      <BracketsTabla brackets={brackets} onChange={setBrackets} />
      {(invalido || error) && (
        <p role="alert" className="text-xs text-wine">
          {invalido || error}
        </p>
      )}
      {ok && !error && !invalido && <p className="text-xs text-emerald-700">{ok}</p>}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className="px-2.5 py-1.5 text-xs"
          onClick={() => setAbierto(false)}
        >
          Cancela
        </Button>
        <Button type="submit" variant="gold" className="px-2.5 py-1.5 text-xs" disabled={pendiente}>
          <Save size={13} /> {pendiente ? 'Creando…' : 'Crear paquete'}
        </Button>
      </div>
    </form>
  );
}
