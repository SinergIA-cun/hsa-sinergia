import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Save } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { Button, Card, Field, TextInput } from '../ui.tsx';
import type { Banquetero, VentaBanquetero } from '../../lib/types.ts';
import { apiErrorMessage, ConfirmDelete } from './shared.tsx';

type BanqueteroPatch = Partial<Pick<Banquetero, 'nombre' | 'telefono' | 'activo'>>;

export function BanqueterosSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-banqueteros'],
    queryFn: () => api.get<{ banqueteros: Banquetero[] }>('/api/admin/banqueteros'),
  });
  const ventasQ = useQuery({
    queryKey: ['admin-banqueteros-ventas'],
    queryFn: () => api.get<{ ventas: VentaBanquetero[] }>('/api/admin/banqueteros/ventas'),
  });

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['admin-banqueteros'] }),
      qc.invalidateQueries({ queryKey: ['admin-banqueteros-ventas'] }),
      qc.invalidateQueries({ queryKey: ['banqueteros'] }),
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

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl text-ink">Banqueteros</h2>
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
  onSave,
  onToggleActivo,
  onDelete,
  saving,
}: {
  banquetero: Banquetero;
  venta?: VentaBanquetero;
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

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className={`font-medium ${b.activo ? 'text-ink' : 'text-charcoal-soft line-through'}`}>{b.nombre}</p>
        <p className="text-xs text-charcoal-soft">
          {venta ? `${venta.eventos} evento(s) · ${formatMXN(venta.totalContratos)}` : 'Sin eventos'}
          {b.telefono ? ` · ${b.telefono}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1">
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
