import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Pencil } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { Button, Card, TextInput } from '../ui.tsx';
import type { Proveedor } from '../../lib/types.ts';
import { apiErrorMessage } from './shared.tsx';

export const PROVEEDORES_KEY = ['admin-proveedores'];

/** Los proveedores, para la sección y para el selector de cada servicio. */
export function useProveedores() {
  return useQuery({
    queryKey: PROVEEDORES_KEY,
    queryFn: () => api.get<{ proveedores: Proveedor[] }>('/api/admin/proveedores'),
    select: (d) => d.proveedores,
  });
}

/**
 * Quién da cada servicio del catálogo (mesa de dulces, grupo, cabina…). Se dan
 * de alta aquí y se asignan en el servicio, con su comisión, dentro del
 * catálogo. No se borran: se desactivan, porque los catálogos de años pasados
 * los siguen nombrando.
 */
export function ProveedoresSection() {
  const qc = useQueryClient();
  const { data: proveedores = [] } = useProveedores();
  const invalidar = () => qc.invalidateQueries({ queryKey: PROVEEDORES_KEY });

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState('');
  const crear = useMutation({
    mutationFn: () => api.post('/api/admin/proveedores', { nombre: nombre.trim(), telefono: telefono.trim() || null }),
    onSuccess: async () => {
      setNombre('');
      setTelefono('');
      setError('');
      await invalidar();
    },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo agregar el proveedor.')),
  });
  const editar = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Proveedor, 'nombre' | 'telefono' | 'activo'>> }) =>
      api.patch(`/api/admin/proveedores/${id}`, data),
    onSuccess: invalidar,
  });

  return (
    <section>
      <h2 className="mb-1 font-display text-2xl text-ink">Proveedores</h2>
      <p className="mb-4 max-w-2xl text-sm text-charcoal-soft">
        Quién da los servicios del catálogo. El proveedor y la comisión de cada servicio se ponen al
        editarlo, en Catálogos → Servicios.
      </p>
      <Card className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
        {proveedores.length === 0 ? (
          <p className="text-sm text-charcoal-soft">Aún no hay proveedores.</p>
        ) : (
          <ul className="divide-y divide-cream-200">
            {proveedores.map((p) => (
              <ProveedorRow
                key={p.id}
                proveedor={p}
                guardando={editar.isPending}
                onGuardar={(data) => editar.mutateAsync({ id: p.id, data })}
              />
            ))}
          </ul>
        )}
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (nombre.trim()) crear.mutate();
          }}
          className="space-y-2 rounded-lg bg-cream-100 p-4"
        >
          <h3 className="font-display text-base text-ink">Nuevo proveedor</h3>
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej. Dulces Lupita)" aria-label="Nombre del proveedor" />
          <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Teléfono (opcional)" aria-label="Teléfono del proveedor" />
          {error && (
            <p role="alert" className="text-xs text-wine">
              {error}
            </p>
          )}
          <Button type="submit" variant="gold" className="w-full" disabled={crear.isPending || !nombre.trim()}>
            <Plus size={15} /> {crear.isPending ? 'Agregando…' : 'Agregar proveedor'}
          </Button>
        </form>
      </Card>
    </section>
  );
}

function ProveedorRow({
  proveedor: p,
  guardando,
  onGuardar,
}: {
  proveedor: Proveedor;
  guardando: boolean;
  onGuardar: (data: Partial<Pick<Proveedor, 'nombre' | 'telefono' | 'activo'>>) => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(p.nombre);
  const [telefono, setTelefono] = useState(p.telefono ?? '');
  const [error, setError] = useState('');

  async function guardar() {
    if (!nombre.trim()) return;
    try {
      await onGuardar({ nombre: nombre.trim(), telefono: telefono.trim() || null });
      setError('');
      setEditando(false);
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo guardar.'));
    }
  }

  const servicios = p._count?.servicios ?? 0;
  if (editando) {
    return (
      <li className="space-y-2 py-2.5">
        <div className="grid grid-cols-2 gap-2">
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre del proveedor" />
          <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Teléfono" aria-label="Teléfono del proveedor" />
        </div>
        {error && (
          <p role="alert" className="text-xs text-wine">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="gold" className="px-3 py-1.5 text-xs" disabled={guardando} onClick={() => void guardar()}>
            <Save size={13} /> Guardar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => {
              setEditando(false);
              setNombre(p.nombre);
              setTelefono(p.telefono ?? '');
              setError('');
            }}
          >
            Cancela
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className={`text-sm ${p.activo ? 'text-ink' : 'text-charcoal-soft line-through'}`}>
        {p.nombre}
        <span className="text-charcoal-soft">
          {p.telefono ? ` · ${p.telefono}` : ''} · {servicios} servicio{servicios === 1 ? '' : 's'}
        </span>
      </span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => setEditando(true)}>
          <Pencil size={13} /> Editar
        </Button>
        <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={guardando} onClick={() => void onGuardar({ activo: !p.activo })}>
          {p.activo ? 'Desactivar' : 'Activar'}
        </Button>
      </div>
    </li>
  );
}
