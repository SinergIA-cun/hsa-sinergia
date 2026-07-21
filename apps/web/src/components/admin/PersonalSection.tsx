import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Pencil } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { Button, Card, TextInput } from '../ui.tsx';
import type { Empleado, Cuadrilla } from '../../lib/types.ts';
import { apiErrorMessage, ConfirmDelete } from './shared.tsx';

export function PersonalSection() {
  const qc = useQueryClient();
  const empQ = useQuery({
    queryKey: ['admin-empleados'],
    queryFn: () => api.get<{ empleados: Empleado[] }>('/api/admin/empleados'),
  });
  const cuadQ = useQuery({
    queryKey: ['admin-cuadrillas'],
    queryFn: () => api.get<{ cuadrillas: Cuadrilla[] }>('/api/admin/cuadrillas'),
  });
  const empleados = empQ.data?.empleados ?? [];
  const cuadrillas = cuadQ.data?.cuadrillas ?? [];
  const empleadosActivos = empleados.filter((e) => e.activo);

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['admin-empleados'] }),
      qc.invalidateQueries({ queryKey: ['admin-cuadrillas'] }),
      qc.invalidateQueries({ queryKey: ['empleados'] }),
      qc.invalidateQueries({ queryKey: ['cuadrillas'] }),
    ]);
  }

  // --- Empleados ---
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState('');
  const [error, setError] = useState('');
  const updateEmp = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Empleado, 'nombre' | 'rol' | 'activo'>> }) =>
      api.patch(`/api/admin/empleados/${id}`, data),
    onSuccess: invalidate,
  });
  const deleteEmp = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/empleados/${id}`),
    onSuccess: invalidate,
  });
  const crearEmp = useMutation({
    mutationFn: () => api.post('/api/admin/empleados', { nombre, rol: rol || undefined }),
    onSuccess: async () => { setNombre(''); setRol(''); setError(''); await invalidate(); },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo crear el empleado.')),
  });

  // --- Cuadrillas ---
  const [cNombre, setCNombre] = useState('');
  const [cMiembros, setCMiembros] = useState<string[]>([]);
  const [cError, setCError] = useState('');
  const updateCuad = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { nombre?: string; activo?: boolean; empleadoIds?: string[] } }) =>
      api.patch(`/api/admin/cuadrillas/${id}`, data),
    onSuccess: invalidate,
  });
  const deleteCuad = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/cuadrillas/${id}`),
    onSuccess: invalidate,
  });
  const crearCuad = useMutation({
    mutationFn: () => api.post('/api/admin/cuadrillas', { nombre: cNombre, empleadoIds: cMiembros }),
    onSuccess: async () => { setCNombre(''); setCMiembros([]); setCError(''); await invalidate(); },
    onError: (e) => setCError(apiErrorMessage(e, 'No se pudo crear la cuadrilla.')),
  });
  const toggleMiembroNuevo = (id: string) =>
    setCMiembros((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl text-ink">Personal y cuadrillas</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Empleados */}
        <Card className="space-y-4 p-6">
          <h3 className="font-display text-lg text-ink">Empleados</h3>
          {empleados.length === 0 ? (
            <p className="text-sm text-charcoal-soft">Aún no hay empleados.</p>
          ) : (
            <ul className="divide-y divide-cream-200">
              {empleados.map((e) => (
                <EmpleadoRow
                  key={e.id}
                  empleado={e}
                  onSave={(data) => updateEmp.mutateAsync({ id: e.id, data })}
                  onToggleActivo={() => updateEmp.mutate({ id: e.id, data: { activo: !e.activo } })}
                  onDelete={() => deleteEmp.mutateAsync(e.id)}
                  saving={updateEmp.isPending}
                />
              ))}
            </ul>
          )}
          <form onSubmit={(ev) => { ev.preventDefault(); if (nombre.trim()) crearEmp.mutate(); }} className="grid grid-cols-2 gap-2">
            <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
            <TextInput value={rol} onChange={(e) => setRol(e.target.value)} placeholder="Rol (opcional)" />
            {error && <p className="col-span-2 text-sm text-wine">{error}</p>}
            <Button type="submit" variant="gold" className="col-span-2" disabled={crearEmp.isPending}>
              <Plus size={15} /> Agregar empleado
            </Button>
          </form>
        </Card>

        {/* Cuadrillas */}
        <Card className="space-y-4 p-6">
          <h3 className="font-display text-lg text-ink">Cuadrillas</h3>
          {cuadrillas.length === 0 ? (
            <p className="text-sm text-charcoal-soft">Aún no hay cuadrillas.</p>
          ) : (
            <ul className="divide-y divide-cream-200">
              {cuadrillas.map((c) => (
                <CuadrillaRow
                  key={c.id}
                  cuadrilla={c}
                  empleadosActivos={empleadosActivos}
                  onSave={(data) => updateCuad.mutateAsync({ id: c.id, data })}
                  onToggleActivo={() => updateCuad.mutate({ id: c.id, data: { activo: !c.activo } })}
                  onDelete={() => deleteCuad.mutateAsync(c.id)}
                  saving={updateCuad.isPending}
                />
              ))}
            </ul>
          )}
          <form onSubmit={(ev) => { ev.preventDefault(); if (cNombre.trim()) crearCuad.mutate(); }} className="space-y-3">
            <TextInput value={cNombre} onChange={(e) => setCNombre(e.target.value)} placeholder="Nombre de la cuadrilla (ej. Cuadrilla A)" />
            {empleadosActivos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {empleadosActivos.map((e) => (
                  <MiembroChip key={e.id} nombre={e.nombre} activo={cMiembros.includes(e.id)} onClick={() => toggleMiembroNuevo(e.id)} />
                ))}
              </div>
            )}
            {cError && <p className="text-sm text-wine">{cError}</p>}
            <Button type="submit" variant="gold" disabled={crearCuad.isPending}>
              <Plus size={15} /> Crear cuadrilla
            </Button>
          </form>
        </Card>
      </div>
    </section>
  );
}

function MiembroChip({ nombre, activo, onClick }: { nombre: string; activo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        activo ? 'border-gold bg-gold/15 text-ink' : 'border-ink/15 text-charcoal-soft hover:border-ink/30'
      }`}
    >
      {nombre}
    </button>
  );
}

function EmpleadoRow({
  empleado: e,
  onSave,
  onToggleActivo,
  onDelete,
  saving,
}: {
  empleado: Empleado;
  onSave: (data: { nombre?: string; rol?: string | null }) => Promise<unknown>;
  onToggleActivo: () => void;
  onDelete: () => Promise<unknown>;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(e.nombre);
  const [rol, setRol] = useState(e.rol ?? '');

  async function guardar() {
    if (!nombre.trim()) return;
    await onSave({ nombre: nombre.trim(), rol: rol.trim() || null });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="space-y-2 py-2.5">
        <div className="grid grid-cols-2 gap-2">
          <TextInput value={nombre} onChange={(ev) => setNombre(ev.target.value)} placeholder="Nombre" />
          <TextInput value={rol} onChange={(ev) => setRol(ev.target.value)} placeholder="Rol" />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="gold" className="px-3 py-1.5 text-xs" disabled={saving} onClick={guardar}>
            <Save size={13} /> Guardar
          </Button>
          <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => { setEditing(false); setNombre(e.nombre); setRol(e.rol ?? ''); }}>
            Cancela
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className={`text-sm ${e.activo ? 'text-ink' : 'text-charcoal-soft line-through'}`}>
        {e.nombre}{e.rol ? <span className="text-charcoal-soft"> · {e.rol}</span> : null}
      </span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => setEditing(true)}>
          <Pencil size={13} /> Editar
        </Button>
        <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={saving} onClick={onToggleActivo}>
          {e.activo ? 'Desactivar' : 'Activar'}
        </Button>
        <ConfirmDelete onConfirm={onDelete} />
      </div>
    </li>
  );
}

function CuadrillaRow({
  cuadrilla: c,
  empleadosActivos,
  onSave,
  onToggleActivo,
  onDelete,
  saving,
}: {
  cuadrilla: Cuadrilla;
  empleadosActivos: Empleado[];
  onSave: (data: { nombre?: string; empleadoIds?: string[] }) => Promise<unknown>;
  onToggleActivo: () => void;
  onDelete: () => Promise<unknown>;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(c.nombre);
  const [miembros, setMiembros] = useState<string[]>(() => c.miembros.map((m) => m.empleado.id));

  // Empleados a mostrar: los activos + los que ya son miembros aunque estén inactivos.
  const opciones = [
    ...empleadosActivos,
    ...c.miembros.map((m) => m.empleado).filter((e) => !empleadosActivos.some((a) => a.id === e.id)),
  ];
  const toggle = (id: string) =>
    setMiembros((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function guardar() {
    if (!nombre.trim()) return;
    await onSave({ nombre: nombre.trim(), empleadoIds: miembros });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="space-y-3 py-2.5">
        <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la cuadrilla" />
        <div className="flex flex-wrap gap-2">
          {opciones.map((e) => (
            <MiembroChip key={e.id} nombre={e.nombre} activo={miembros.includes(e.id)} onClick={() => toggle(e.id)} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="gold" className="px-3 py-1.5 text-xs" disabled={saving} onClick={guardar}>
            <Save size={13} /> Guardar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => { setEditing(false); setNombre(c.nombre); setMiembros(c.miembros.map((m) => m.empleado.id)); }}
          >
            Cancela
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <p className={`font-medium ${c.activo ? 'text-ink' : 'text-charcoal-soft line-through'}`}>{c.nombre}</p>
        <p className="text-xs text-charcoal-soft">
          {c.miembros.map((m) => m.empleado.nombre).join(', ') || 'Sin miembros'}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => setEditing(true)}>
          <Pencil size={13} /> Editar
        </Button>
        <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={saving} onClick={onToggleActivo}>
          {c.activo ? 'Desactivar' : 'Activar'}
        </Button>
        <ConfirmDelete onConfirm={onDelete} />
      </div>
    </li>
  );
}
