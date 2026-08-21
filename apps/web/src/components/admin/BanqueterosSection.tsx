import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Coins, Pencil, Save } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button, Card, Field, TextInput } from '../ui.tsx';
import {
  ADMIN_BANQUETEROS_KEY,
  BANQUETEROS_KEY,
  BANQUETEROS_VENTAS_KEY,
  RESUMEN_BANQUETEROS_KEY,
} from '../../lib/banqueteros.ts';
import type { Banquetero, ResumenBanquetero, VentaBanquetero } from '../../lib/types.ts';
import { apiErrorMessage, ConfirmDelete } from './shared.tsx';

type BanqueteroPatch = Partial<Pick<Banquetero, 'nombre' | 'telefono' | 'activo'>>;

export function BanqueterosSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ADMIN_BANQUETEROS_KEY,
    queryFn: () => api.get<{ banqueteros: Banquetero[] }>('/api/admin/banqueteros'),
  });
  const ventasQ = useQuery({
    queryKey: BANQUETEROS_VENTAS_KEY,
    queryFn: () => api.get<{ ventas: VentaBanquetero[] }>('/api/admin/banqueteros/ventas'),
  });
  // La cuenta corriente de todos en una consulta: el saldo sin asignar y los
  // apartados por vencer. Sin esto la lista pediría un estado de cuenta completo
  // por banquetero para pintar dos números.
  const resumenQ = useQuery({
    queryKey: RESUMEN_BANQUETEROS_KEY,
    queryFn: () =>
      api.get<{ banqueteros: ResumenBanquetero[]; totalSinAsignar: number }>(
        '/api/banqueteros/resumen',
      ),
  });

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ADMIN_BANQUETEROS_KEY }),
      qc.invalidateQueries({ queryKey: BANQUETEROS_VENTAS_KEY }),
      qc.invalidateQueries({ queryKey: RESUMEN_BANQUETEROS_KEY }),
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

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState('');

  const crear = useMutation({
    mutationFn: () =>
      api.post<{ banquetero: Banquetero }>('/api/admin/banqueteros', { nombre, telefono: telefono || undefined }),
    onSuccess: async () => {
      setNombre('');
      setTelefono('');
      setError('');
      await invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo crear el banquetero.')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    crear.mutate();
  }

  const banqueteros = data?.banqueteros ?? [];
  const ventas = ventasQ.data?.ventas ?? [];
  const ventasById = new Map(ventas.map((v) => [v.banqueteroId, v]));
  const resumenById = new Map((resumenQ.data?.banqueteros ?? []).map((r) => [r.banqueteroId, r]));
  const totalSinAsignar = resumenQ.data?.totalSinAsignar ?? 0;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl text-ink">Banqueteros</h2>
        {/* El total sin asignar de toda la cartera. Es dinero de la hacienda sin
            destino y hoy nadie lo puede decir sin sentarse a sumar. */}
        {totalSinAsignar > 0 && (
          <p className="inline-flex items-center gap-2 rounded-lg border-l-4 border-gold bg-gold/15 px-4 py-2 text-sm text-ink">
            <Coins size={15} className="text-gold" />
            <span>
              <strong className="font-display text-lg">{formatMXN(totalSinAsignar)}</strong> sin
              repartir entre todos
            </span>
          </p>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          {isLoading ? (
            <p className="text-sm text-charcoal-soft">Cargando…</p>
          ) : banqueteros.length === 0 ? (
            <p className="text-sm text-charcoal-soft">Aún no hay banqueteros.</p>
          ) : (
            <ul className="divide-y divide-cream-200">
              {banqueteros.map((b) => (
                <BanqueteroRow
                  key={b.id}
                  banquetero={b}
                  venta={ventasById.get(b.id)}
                  resumen={resumenById.get(b.id)}
                  onSave={(data) => updateBanq.mutateAsync({ id: b.id, data })}
                  onToggleActivo={() => updateBanq.mutate({ id: b.id, data: { activo: !b.activo } })}
                  onDelete={() => deleteBanq.mutateAsync(b.id)}
                  saving={updateBanq.isPending}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4 p-6">
          <h3 className="font-display text-lg text-ink">Nuevo banquetero</h3>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Nombre">
              <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej. Carlos Barrera" />
            </Field>
            <Field label="Teléfono (opcional)">
              <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="ej. 55 1234 5678" />
            </Field>
            {error && <p className="text-sm text-wine">{error}</p>}
            <Button type="submit" variant="gold" disabled={crear.isPending}>
              {crear.isPending ? 'Guardando…' : 'Agregar banquetero'}
            </Button>
          </form>
          <p className="text-xs text-charcoal-soft">
            Las ventas por banquetero cuentan los contratos donde se le asignó en la hoja operativa.
          </p>
        </Card>
      </div>
    </section>
  );
}

function BanqueteroRow({
  banquetero: b,
  venta,
  resumen,
  onSave,
  onToggleActivo,
  onDelete,
  saving,
}: {
  banquetero: Banquetero;
  venta?: VentaBanquetero;
  resumen?: ResumenBanquetero;
  onSave: (data: BanqueteroPatch) => Promise<unknown>;
  onToggleActivo: () => void;
  onDelete: () => Promise<unknown>;
  saving: boolean;
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
      <li className="space-y-2 py-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
          <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Teléfono" />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="gold" className="px-3 py-1.5 text-xs" disabled={saving} onClick={guardar}>
            <Save size={13} /> Guardar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => { setEditing(false); setNombre(b.nombre); setTelefono(b.telefono ?? ''); }}
          >
            Cancela
          </Button>
        </div>
      </li>
    );
  }

  const sinAsignar = resumen?.saldoSinAsignar ?? 0;
  const porVencer = resumen?.apartadosPorVencer ?? 0;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        {/* El nombre lleva a su cuenta corriente: depósitos, reparto y apartados. */}
        <Link
          to={`/banqueteros/${b.id}`}
          className={`font-medium hover:text-gold hover:underline ${
            b.activo ? 'text-ink' : 'text-charcoal-soft line-through'
          }`}
        >
          {b.nombre}
        </Link>
        <p className="text-xs text-charcoal-soft">
          {venta ? `${venta.eventos} evento(s) · ${formatMXN(venta.totalContratos)}` : 'Sin eventos'}
          {b.telefono ? ` · ${b.telefono}` : ''}
        </p>
        {/* El saldo sin asignar SE DESTACA: es dinero recibido sin destino, no una
            cifra más de la ficha. */}
        {(sinAsignar > 0 || porVencer > 0) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {sinAsignar > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-gold/20 px-1.5 py-0.5 font-semibold text-gold">
                <Coins size={11} /> {formatMXN(sinAsignar)} sin repartir
              </span>
            )}
            {porVencer > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-wine/10 px-1.5 py-0.5 font-semibold text-wine">
                <CalendarClock size={11} /> {porVencer} apartado(s) por vencer
                {resumen?.proximoVencimientoISO
                  ? ` · ${formatEventDate(resumen.proximoVencimientoISO)}`
                  : ''}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Link to={`/banqueteros/${b.id}`}>
          <Button type="button" variant="outline" className="px-2.5 py-1.5 text-xs">
            <Coins size={13} /> Cuenta
          </Button>
        </Link>
        <Button type="button" variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => setEditing(true)}>
          <Pencil size={13} /> Editar
        </Button>
        <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={saving} onClick={onToggleActivo}>
          {b.activo ? 'Desactivar' : 'Activar'}
        </Button>
        <ConfirmDelete onConfirm={onDelete} />
      </div>
    </li>
  );
}
