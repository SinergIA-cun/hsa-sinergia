import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Coins,
  Pencil,
  Phone,
  Plus,
  Save,
  Search,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { coincideTexto } from '@hsa/shared';
import { useAuth } from '../auth/auth.tsx';
import { ArrowDivider, Button, Card, Field, TextInput } from '../components/ui.tsx';
import { apiErrorMessage, ConfirmDelete } from '../components/admin/shared.tsx';
import {
  ADMIN_BANQUETEROS_KEY,
  BANQUETEROS_KEY,
  BANQUETEROS_VENTAS_KEY,
  RESUMEN_BANQUETEROS_KEY,
} from '../lib/banqueteros.ts';
import type { Banquetero, ResumenBanquetero, VentaBanquetero } from '../lib/types.ts';

type BanqueteroPatch = Partial<Pick<Banquetero, 'nombre' | 'telefono' | 'activo'>>;

/** Cuántos se pintan antes de pedir que se afine la búsqueda. */
const TOPE_LISTA = 50;

type Filtro = 'activos' | 'sin-repartir' | 'por-vencer' | 'inactivos';

/**
 * La sección de banqueteros: la contraparte que compra eventos al mayoreo.
 *
 * Vivía dentro del panel de admin, entre usuarios y catálogos, y eso tenía dos
 * defectos que se ven en cuanto la cartera crece: ventas no la podía abrir
 * —`/admin` los rebota— aunque sí puede repartir un depósito y vender a nombre
 * de un banquetero, y la lista era un bloque sin buscador que con 200 nombres
 * se vuelve un scroll ciego.
 *
 * Aquí es su propia pantalla, con buscador y filtros por lo único que urge:
 * dinero recibido sin repartir y fechas apartadas por vencer. Las altas, bajas
 * y ediciones siguen siendo de admin —la API las exige— pero la consulta y la
 * cuenta corriente son de todo el equipo.
 */
export function BanqueterosPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();

  // El resumen es la fuente de la lista: trae a TODOS (activos e inactivos) con
  // su saldo sin asignar y sus apartados, y lo puede leer ventas. La lista de
  // `/admin/banqueteros` diría lo mismo pero con 403 para media plantilla.
  const resumenQ = useQuery({
    queryKey: RESUMEN_BANQUETEROS_KEY,
    queryFn: () =>
      api.get<{ banqueteros: ResumenBanquetero[]; totalSinAsignar: number }>(
        '/api/banqueteros/resumen',
      ),
  });
  // El monto vendido por banquetero solo lo devuelve admin; para ventas la
  // columna simplemente no existe en vez de reintentar un 403 tres veces.
  const ventasQ = useQuery({
    queryKey: BANQUETEROS_VENTAS_KEY,
    queryFn: () => api.get<{ ventas: VentaBanquetero[] }>('/api/admin/banqueteros/ventas'),
    enabled: isAdmin,
  });

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: RESUMEN_BANQUETEROS_KEY }),
      qc.invalidateQueries({ queryKey: BANQUETEROS_VENTAS_KEY }),
      qc.invalidateQueries({ queryKey: ADMIN_BANQUETEROS_KEY }),
      // El buscador del cotizador lee esta llave: un banquetero recién dado de
      // alta tiene que aparecer ahí sin recargar la app.
      qc.invalidateQueries({ queryKey: BANQUETEROS_KEY }),
    ]);
  }

  const updateBanq = useMutation({
    mutationFn: ({ id, data }: { id: string; data: BanqueteroPatch }) =>
      api.patch<{ banquetero: Banquetero }>(`/api/admin/banqueteros/${id}`, data),
    onSuccess: invalidate,
  });
  const deleteBanq = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/banqueteros/${id}`),
    onSuccess: invalidate,
  });

  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('activos');
  const [verTodos, setVerTodos] = useState(false);
  const [alta, setAlta] = useState(false);

  const todos = useMemo(() => resumenQ.data?.banqueteros ?? [], [resumenQ.data]);
  const ventasById = useMemo(
    () => new Map((ventasQ.data?.ventas ?? []).map((v) => [v.banqueteroId, v])),
    [ventasQ.data],
  );
  const totalSinAsignar = resumenQ.data?.totalSinAsignar ?? 0;

  const conteos = {
    activos: todos.filter((b) => b.activo).length,
    'sin-repartir': todos.filter((b) => b.saldoSinAsignar > 0).length,
    'por-vencer': todos.filter((b) => b.apartadosPorVencer > 0).length,
    inactivos: todos.filter((b) => !b.activo).length,
  } satisfies Record<Filtro, number>;

  const filtrados = useMemo(() => {
    const needle = q.trim();
    // Buscar es buscar en TODA la cartera: si alguien teclea el nombre de un
    // banquetero dado de baja, encontrarlo vale más que respetar el filtro. Por
    // eso la búsqueda IGNORA el filtro en vez de combinarse con él, que es como
    // se llega a "no aparece" teniendo el registro enfrente.
    if (needle) return todos.filter((b) => coincideTexto([b.nombre, b.telefono], needle));
    return todos.filter((b) => {
      if (filtro === 'activos') return b.activo;
      if (filtro === 'inactivos') return !b.activo;
      if (filtro === 'sin-repartir') return b.saldoSinAsignar > 0;
      return b.apartadosPorVencer > 0;
    });
  }, [todos, filtro, q]);

  const visibles = verTodos ? filtrados : filtrados.slice(0, TOPE_LISTA);
  const ocultos = filtrados.length - visibles.length;

  const chip = (key: Filtro, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        setFiltro(key);
        setVerTodos(false);
      }}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        filtro === key
          ? 'border-ink bg-ink text-cream'
          : 'border-cream-300 bg-white/70 text-ink hover:border-ink/40'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-[0.7rem] font-semibold ${
          filtro === key ? 'bg-cream/20' : 'bg-ink/10'
        }`}
      >
        {conteos[key]}
      </span>
    </button>
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>Cartera</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">Banqueteros</h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            Quien compra eventos al mayoreo y los revende. Cada uno tiene cuenta corriente.
          </p>
        </div>
        {isAdmin && (
          <Button variant="gold" onClick={() => setAlta((a) => !a)}>
            {alta ? <X size={16} /> : <Plus size={16} />}
            {alta ? 'Cerrar' : 'Nuevo banquetero'}
          </Button>
        )}
      </div>

      {/* El dinero de la hacienda que entró y todavía no tiene evento. Es el
          número que nadie podía decir sin sentarse a sumar. */}
      {totalSinAsignar > 0 && (
        <p className="mb-6 inline-flex items-center gap-2 rounded-lg border-l-4 border-gold bg-gold/15 px-4 py-2.5 text-sm text-ink">
          <Coins size={16} className="text-gold" />
          <span>
            <strong className="font-display text-lg">{formatMXN(totalSinAsignar)}</strong> recibidos
            sin repartir entre toda la cartera
          </span>
        </p>
      )}

      {isAdmin && alta && <AltaBanquetero onCreado={invalidate} onCerrar={() => setAlta(false)} />}

      <div className="relative mb-4 max-w-md">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setVerTodos(false);
          }}
          placeholder="Buscar por nombre o teléfono…"
          className="w-full rounded-lg border border-ink/15 bg-white/70 py-2.5 pl-9 pr-3 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {chip('activos', 'Activos')}
        {chip('sin-repartir', 'Con dinero sin repartir')}
        {chip('por-vencer', 'Apartados por vencer')}
        {chip('inactivos', 'Inactivos')}
      </div>
      {q.trim() && (
        <p className="mb-3 text-xs text-charcoal-soft">
          Buscando en toda la cartera, incluidos los inactivos.
        </p>
      )}

      {resumenQ.isLoading ? (
        <p className="text-charcoal-soft">Cargando…</p>
      ) : filtrados.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="font-display text-xl text-ink">
            {q.trim() ? `Sin coincidencias para “${q.trim()}”` : 'Nada por aquí'}
          </p>
          <p className="mt-2 text-sm text-charcoal-soft">
            {q.trim()
              ? 'Revisa el nombre, o dalo de alta si es nuevo.'
              : 'Ningún banquetero cae en este filtro.'}
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-cream-200">
            {visibles.map((b) => (
              <BanqueteroRow
                key={b.banqueteroId}
                b={b}
                venta={ventasById.get(b.banqueteroId)}
                isAdmin={isAdmin}
                saving={updateBanq.isPending}
                onSave={(data) => updateBanq.mutateAsync({ id: b.banqueteroId, data })}
                onToggleActivo={() =>
                  updateBanq.mutate({ id: b.banqueteroId, data: { activo: !b.activo } })
                }
                onDelete={() => deleteBanq.mutateAsync(b.banqueteroId)}
              />
            ))}
          </ul>
        </Card>
      )}

      {ocultos > 0 && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => setVerTodos(true)}>
            Mostrar los {ocultos} restantes
          </Button>
        </div>
      )}
    </div>
  );
}

/** Alta de banquetero. Solo admin la ve: la API responde 403 a ventas. */
function AltaBanquetero({
  onCreado,
  onCerrar,
}: {
  onCreado: () => Promise<void>;
  onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState('');

  const crear = useMutation({
    mutationFn: () =>
      api.post<{ banquetero: Banquetero }>('/api/admin/banqueteros', {
        nombre: nombre.trim(),
        telefono: telefono.trim() || undefined,
      }),
    onSuccess: async () => {
      setNombre('');
      setTelefono('');
      setError('');
      await onCreado();
      onCerrar();
    },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo crear el banquetero.')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    crear.mutate();
  }

  return (
    <Card className="mb-6 p-6">
      <h2 className="mb-4 font-display text-lg text-ink">Nuevo banquetero</h2>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Nombre">
          <TextInput
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="ej. Carlos Barrera"
          />
        </Field>
        <Field label="Teléfono (opcional)">
          <TextInput
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="ej. 55 1234 5678"
          />
        </Field>
        <Button type="submit" variant="gold" disabled={crear.isPending}>
          {crear.isPending ? 'Guardando…' : 'Agregar'}
        </Button>
      </form>
      {error && <p className="mt-3 text-sm text-wine">{error}</p>}
    </Card>
  );
}

function BanqueteroRow({
  b,
  venta,
  isAdmin,
  saving,
  onSave,
  onToggleActivo,
  onDelete,
}: {
  b: ResumenBanquetero;
  venta?: VentaBanquetero;
  isAdmin: boolean;
  saving: boolean;
  onSave: (data: BanqueteroPatch) => Promise<unknown>;
  onToggleActivo: () => void;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(b.nombre);
  const [telefono, setTelefono] = useState(b.telefono ?? '');

  async function guardar() {
    if (!nombre.trim()) return;
    await onSave({ nombre: nombre.trim(), telefono: telefono.trim() || null });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="space-y-2 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
          <TextInput
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Teléfono"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="gold"
            className="px-3 py-1.5 text-xs"
            disabled={saving}
            onClick={guardar}
          >
            <Save size={13} /> Guardar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => {
              setEditing(false);
              setNombre(b.nombre);
              setTelefono(b.telefono ?? '');
            }}
          >
            Cancela
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-cream-100/60">
      <div className="min-w-[12rem] flex-1">
        <Link
          to={`/banqueteros/${b.banqueteroId}`}
          className={`font-medium hover:text-gold hover:underline ${
            b.activo ? 'text-ink' : 'text-charcoal-soft line-through'
          }`}
        >
          {b.nombre}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-charcoal-soft">
          {b.telefono && (
            <span className="inline-flex items-center gap-1">
              <Phone size={11} /> {b.telefono}
            </span>
          )}
          <span>
            {b.eventos === 0 ? 'Sin eventos' : `${b.eventos} evento${b.eventos === 1 ? '' : 's'}`}
            {venta && venta.totalContratos > 0 ? ` · ${formatMXN(venta.totalContratos)}` : ''}
          </span>
          {b.apartadosVivos > 0 && (
            <span>
              {b.apartadosVivos} fecha{b.apartadosVivos === 1 ? '' : 's'} apartada
              {b.apartadosVivos === 1 ? '' : 's'}
            </span>
          )}
        </p>
        {(b.saldoSinAsignar > 0 || b.apartadosPorVencer > 0) && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {b.saldoSinAsignar > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-gold/20 px-1.5 py-0.5 font-semibold text-gold">
                <Coins size={11} /> {formatMXN(b.saldoSinAsignar)} sin repartir
              </span>
            )}
            {b.apartadosPorVencer > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-wine/10 px-1.5 py-0.5 font-semibold text-wine">
                <CalendarClock size={11} /> {b.apartadosPorVencer} por vencer
                {b.proximoVencimientoISO ? ` · ${formatEventDate(b.proximoVencimientoISO)}` : ''}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Link to={`/banqueteros/${b.banqueteroId}`}>
          <Button type="button" variant="outline" className="px-2.5 py-1.5 text-xs">
            <Coins size={13} /> Cuenta
          </Button>
        </Link>
        {isAdmin && (
          <>
            <Button
              type="button"
              variant="outline"
              className="px-2.5 py-1.5 text-xs"
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} /> Editar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="px-2.5 py-1.5 text-xs"
              disabled={saving}
              onClick={onToggleActivo}
            >
              {b.activo ? 'Desactivar' : 'Activar'}
            </Button>
            <ConfirmDelete onConfirm={onDelete} />
          </>
        )}
      </div>
    </li>
  );
}
