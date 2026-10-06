import { useState, type FormEvent } from 'react';
import { Plus, Save, Check, X, Pencil } from 'lucide-react';
import { formatMXN } from '../../../lib/money.ts';
import { Button, Field, MoneyInput, SelectInput, TextInput } from '../../ui.tsx';
import type { AddOn, Proveedor } from '../../../lib/types.ts';
import { ConfirmDelete } from '../shared.tsx';
import { useProveedores } from '../ProveedoresSection.tsx';
import { useGuardar } from './guardado.tsx';

const KIND_LABEL: Record<AddOn['kind'], string> = {
  fijo: 'Fijo',
  porPersona: 'Por persona',
  porUnidad: 'Por unidad',
};

export type ServicioPatch = Partial<Pick<AddOn, 'nombre' | 'categoria' | 'kind' | 'price' | 'activo' | 'proveedorId' | 'comisionPct'>>;
export type ServicioNuevo = Pick<AddOn, 'nombre' | 'categoria' | 'kind' | 'price' | 'proveedorId' | 'comisionPct'>;

/** "" = sin comisión; si no, un porcentaje de 0 a 100 (acepta decimales). */
function leerComision(v: string): number | null | undefined {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
}

/**
 * Proveedor y comisión del servicio. La comisión es el % del precio sin IVA que
 * gana la hacienda; sin proveedor no hay comisión.
 */
function ProveedorCampos({
  proveedores,
  proveedorId,
  comision,
  onProveedor,
  onComision,
}: {
  proveedores: Proveedor[];
  proveedorId: string;
  comision: string;
  onProveedor: (id: string) => void;
  onComision: (v: string) => void;
}) {
  // Los activos, más el que ya tiene aunque se haya desactivado.
  const opciones = proveedores.filter((p) => p.activo || p.id === proveedorId);
  return (
    <div className="grid grid-cols-[1.6fr_1fr] gap-2">
      <SelectInput
        aria-label="Proveedor"
        value={proveedorId}
        onChange={(e) => {
          onProveedor(e.target.value);
          if (!e.target.value) onComision('');
        }}
      >
        <option value="">Sin proveedor</option>
        {opciones.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </SelectInput>
      <div className="relative">
        <TextInput
          aria-label="Comisión (%)"
          inputMode="decimal"
          placeholder="Comisión"
          disabled={!proveedorId}
          value={comision}
          onChange={(e) => onComision(e.target.value)}
          className="pr-7"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-charcoal-soft">%</span>
      </div>
    </div>
  );
}

/** Los servicios sin categoría van al final, bajo este nombre (igual que al cotizar). */
const SIN_CATEGORIA = 'Otros servicios';
const ID_CATEGORIAS = 'categorias-de-servicio';

/**
 * Campo de categoría con las que ya existen como sugerencia: así "Iluminación" no
 * termina escrita de tres formas y partida en tres grupos.
 */
function CategoriaInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      list={ID_CATEGORIAS}
      aria-label="Categoría"
      placeholder="Categoría (ej. Iluminación)"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function KindSelect({
  value,
  onChange,
}: {
  value: AddOn['kind'];
  onChange: (k: AddOn['kind']) => void;
}) {
  return (
    <SelectInput value={value} onChange={(e) => onChange(e.target.value as AddOn['kind'])}>
      {(Object.keys(KIND_LABEL) as AddOn['kind'][]).map((k) => (
        <option key={k} value={k}>
          {KIND_LABEL[k]}
        </option>
      ))}
    </SelectInput>
  );
}

/**
 * Los servicios (add-ons) del catálogo: alta, baja, edición y activar/desactivar.
 *
 * **Desactivar no es borrar, y es casi siempre lo correcto.** Un servicio
 * desactivado sale del selector del cotizador pero el catálogo lo sigue
 * resolviendo, así que las cotizaciones que ya lo traen se pueden recalcular.
 * Borrarlo con una cotización encima las dejaría irrecalculables, y por eso el
 * servidor responde 409 en ese caso: es la lección del valet.
 */
export function ServiciosSeccion({
  servicios,
  onCrear,
  onEditar,
  onBorrar,
}: {
  servicios: AddOn[];
  onCrear: (datos: ServicioNuevo) => Promise<unknown>;
  onEditar: (id: string, datos: ServicioPatch) => Promise<unknown>;
  onBorrar: (id: string) => Promise<unknown>;
}) {
  const { data: proveedores = [] } = useProveedores();
  const categorias = [...new Set(servicios.map((s) => s.categoria?.trim()).filter((c): c is string => !!c))].sort(
    (a, b) => a.localeCompare(b, 'es'),
  );
  // Agrupados como se ven al cotizar: alfabético por categoría, "Otros" al final.
  const grupos = [...categorias, SIN_CATEGORIA]
    .map((c) => ({
      categoria: c,
      lista: servicios.filter((s) => (s.categoria?.trim() || SIN_CATEGORIA) === c),
    }))
    .filter((g) => g.lista.length > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <datalist id={ID_CATEGORIAS}>
        {categorias.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="space-y-5">
        {servicios.length === 0 ? (
          <p className="text-sm text-charcoal-soft">Este catálogo todavía no tiene servicios.</p>
        ) : (
          grupos.map((g) => (
            <section key={g.categoria}>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                {g.categoria} <span className="font-normal text-charcoal-soft">· {g.lista.length}</span>
              </h4>
              <ul className="divide-y divide-cream-300">
                {g.lista.map((s) => (
                  <ServicioRow
                    key={s.id}
                    servicio={s}
                    proveedores={proveedores}
                    onEditar={(datos) => onEditar(s.id, datos)}
                    onBorrar={() => onBorrar(s.id)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <NuevoServicio onCrear={onCrear} proveedores={proveedores} />
    </div>
  );
}

function ServicioRow({
  servicio,
  proveedores,
  onEditar,
  onBorrar,
}: {
  servicio: AddOn;
  proveedores: Proveedor[];
  onEditar: (datos: ServicioPatch) => Promise<unknown>;
  onBorrar: () => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(servicio.nombre);
  const [categoria, setCategoria] = useState(servicio.categoria ?? '');
  const [kind, setKind] = useState<AddOn['kind']>(servicio.kind);
  const [price, setPrice] = useState(String(servicio.price));
  const [proveedorId, setProveedorId] = useState(servicio.proveedorId ?? '');
  const [comision, setComision] = useState(servicio.comisionPct == null ? '' : String(servicio.comisionPct));
  const [invalido, setInvalido] = useState('');
  const { correr, pendiente, error } = useGuardar('No se pudo guardar el servicio.');
  const proveedor = proveedores.find((p) => p.id === servicio.proveedorId);

  function descartar() {
    setEditando(false);
    setNombre(servicio.nombre);
    setCategoria(servicio.categoria ?? '');
    setKind(servicio.kind);
    setPrice(String(servicio.price));
    setProveedorId(servicio.proveedorId ?? '');
    setComision(servicio.comisionPct == null ? '' : String(servicio.comisionPct));
    setInvalido('');
  }

  async function guardar() {
    const n = Number(price);
    if (!nombre.trim() || !Number.isInteger(n) || n < 0) return;
    const pct = leerComision(comision);
    if (pct === undefined) {
      setInvalido('La comisión es un porcentaje de 0 a 100.');
      return;
    }
    setInvalido('');
    const bien = await correr(
      () =>
        onEditar({
          nombre: nombre.trim(),
          categoria: categoria.trim() || null,
          kind,
          price: n,
          proveedorId: proveedorId || null,
          comisionPct: proveedorId ? pct : null,
        }),
      'Guardado.',
    );
    if (bien) setEditando(false);
  }

  if (editando) {
    return (
      <li className="space-y-2 py-3 first:pt-0 last:pb-0">
        <div className="grid gap-2 sm:grid-cols-[1.5fr_1.2fr_1fr_0.8fr]">
          <TextInput
            value={nombre}
            aria-label="Nombre del servicio"
            onChange={(e) => setNombre(e.target.value)}
          />
          <CategoriaInput value={categoria} onChange={setCategoria} />
          <KindSelect value={kind} onChange={setKind} />
          <MoneyInput aria-label="Precio del servicio" value={price} onValue={setPrice} />
        </div>
        <ProveedorCampos
          proveedores={proveedores}
          proveedorId={proveedorId}
          comision={comision}
          onProveedor={setProveedorId}
          onComision={setComision}
        />
        {(invalido || error) && (
          <p role="alert" className="text-xs text-wine">
            {invalido || error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="gold"
            className="px-3 py-1.5 text-xs"
            disabled={pendiente}
            onClick={() => void guardar()}
          >
            <Save size={13} /> {pendiente ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={descartar}>
            Cancela
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div>
        <p
          className={
            servicio.activo ? 'font-medium text-ink' : 'font-medium text-charcoal-soft line-through'
          }
        >
          {servicio.nombre}
        </p>
        <p className="text-xs text-charcoal-soft">
          {KIND_LABEL[servicio.kind]} · {formatMXN(servicio.price)}
          {proveedor && ` · ${proveedor.nombre}`}
          {proveedor && servicio.comisionPct != null && ` · ${servicio.comisionPct}% comisión`}
          {!servicio.activo && ' · no se ofrece, pero el catálogo lo sigue resolviendo'}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          className="px-2.5 py-1.5 text-xs"
          onClick={() => setEditando(true)}
        >
          <Pencil size={13} /> Editar
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="px-2.5 py-1.5 text-xs"
          disabled={pendiente}
          onClick={() => void correr(() => onEditar({ activo: !servicio.activo }), '')}
        >
          {servicio.activo ? (
            <>
              <X size={13} /> Desactivar
            </>
          ) : (
            <>
              <Check size={13} /> Activar
            </>
          )}
        </Button>
        <ConfirmDelete onConfirm={onBorrar} />
      </div>
    </li>
  );
}

function NuevoServicio({
  onCrear,
  proveedores,
}: {
  onCrear: (datos: ServicioNuevo) => Promise<unknown>;
  proveedores: Proveedor[];
}) {
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('');
  const [kind, setKind] = useState<AddOn['kind']>('fijo');
  const [price, setPrice] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [comision, setComision] = useState('');
  const [invalido, setInvalido] = useState('');
  const { correr, pendiente, error, ok } = useGuardar('No se pudo crear el servicio.');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = Number(price);
    if (!nombre.trim() || price.trim() === '' || !Number.isInteger(n) || n < 0) {
      setInvalido('Pon un nombre y un precio en pesos enteros (≥ 0).');
      return;
    }
    const pct = leerComision(comision);
    if (pct === undefined) {
      setInvalido('La comisión es un porcentaje de 0 a 100.');
      return;
    }
    setInvalido('');
    const bien = await correr(
      () =>
        onCrear({
          nombre: nombre.trim(),
          categoria: categoria.trim() || null,
          kind,
          price: n,
          proveedorId: proveedorId || null,
          comisionPct: proveedorId ? pct : null,
        }),
      `“${nombre.trim()}” agregado.`,
    );
    if (bien) {
      // La categoría se queda: casi siempre se dan de alta varios de la misma
      // categoría seguidos (toda la iluminación, luego todo el mobiliario).
      setNombre('');
      setKind('fijo');
      setPrice('');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg bg-cream-100 p-4">
      <h4 className="font-display text-base text-ink">Nuevo servicio</h4>
      <Field label="Nombre">
        <TextInput
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Mesa de dulces"
        />
      </Field>
      <Field label="Categoría" hint="Agrupa los servicios al cotizar. Elige una existente o escribe una nueva.">
        <CategoriaInput value={categoria} onChange={setCategoria} />
      </Field>
      <Field label="Tipo de cobro">
        <KindSelect value={kind} onChange={setKind} />
      </Field>
      <Field label="Precio (MXN)" hint="Pesos enteros, sin centavos.">
        <MoneyInput value={price} onValue={setPrice} placeholder="0" />
      </Field>
      <Field label="Proveedor y comisión" hint="Opcional. La comisión es el % del precio sin IVA que gana la hacienda.">
        <ProveedorCampos
          proveedores={proveedores}
          proveedorId={proveedorId}
          comision={comision}
          onProveedor={setProveedorId}
          onComision={setComision}
        />
      </Field>
      {(invalido || error) && (
        <p role="alert" className="text-xs text-wine">
          {invalido || error}
        </p>
      )}
      {ok && !error && !invalido && <p className="text-xs text-emerald-700">{ok}</p>}
      <Button type="submit" variant="gold" className="w-full" disabled={pendiente}>
        <Plus size={16} /> {pendiente ? 'Agregando…' : 'Agregar al catálogo'}
      </Button>
    </form>
  );
}
