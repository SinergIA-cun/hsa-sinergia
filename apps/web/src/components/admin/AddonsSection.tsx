import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Check, X, Pencil } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { Button, Card, Field, TextInput, SelectInput } from '../ui.tsx';
import type { AddOn } from '../../lib/types.ts';
import { apiErrorMessage, ConfirmDelete } from './shared.tsx';

const ADDON_KIND_LABEL: Record<AddOn['kind'], string> = {
  fijo: 'Fijo',
  porPersona: 'Por persona',
  porUnidad: 'Por unidad',
};

type AddonPatch = Partial<Pick<AddOn, 'nombre' | 'kind' | 'price' | 'activo'>>;

export function AddonsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-addons'],
    queryFn: () => api.get<{ addOns: AddOn[] }>('/api/admin/addons'),
  });
  const addOns = data?.addOns ?? [];

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['admin-addons'] }),
      qc.invalidateQueries({ queryKey: ['catalog'] }),
    ]);
  }

  const updateAddon = useMutation({
    mutationFn: ({ id, data }: { id: string; data: AddonPatch }) =>
      api.patch<{ addOn: AddOn }>(`/api/admin/addons/${id}`, data),
    onSuccess: invalidate,
  });
  const deleteAddon = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/addons/${id}`),
    onSuccess: invalidate,
  });

  const [nombre, setNombre] = useState('');
  const [kind, setKind] = useState<AddOn['kind']>('fijo');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  const createAddon = useMutation({
    mutationFn: () => api.post<{ addOn: AddOn }>('/api/admin/addons', { nombre, kind, price: Number(price) }),
    onSuccess: async () => {
      setNombre('');
      setKind('fijo');
      setPrice('');
      setError('');
      await invalidate();
    },
    onError: (err) => setError(apiErrorMessage(err, 'No se pudo crear el extra.')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const priceNum = Number(price);
    if (!nombre || Number.isNaN(priceNum) || priceNum < 0) {
      setError('Completa nombre y un precio válido (≥ 0).');
      return;
    }
    createAddon.mutate();
  }

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl text-ink">Extras</h2>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-6">
          {isLoading && <p className="text-sm text-charcoal-soft">Cargando…</p>}
          {!isLoading && addOns.length === 0 && (
            <p className="text-sm text-charcoal-soft">Aún no hay extras configurados.</p>
          )}
          {!isLoading && addOns.length > 0 && (
            <ul className="divide-y divide-cream-300">
              {addOns.map((a) => (
                <AddonRow
                  key={a.id}
                  addOn={a}
                  onSave={(data) => updateAddon.mutateAsync({ id: a.id, data })}
                  onToggleActivo={() => updateAddon.mutate({ id: a.id, data: { activo: !a.activo } })}
                  onDelete={() => deleteAddon.mutateAsync(a.id)}
                  saving={updateAddon.isPending}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4 p-6">
          <h3 className="font-display text-lg text-ink">Nuevo extra</h3>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Nombre">
              <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del extra" />
            </Field>
            <Field label="Tipo">
              <SelectInput value={kind} onChange={(e) => setKind(e.target.value as AddOn['kind'])}>
                <option value="fijo">Fijo</option>
                <option value="porPersona">Por persona</option>
                <option value="porUnidad">Por unidad</option>
              </SelectInput>
            </Field>
            <Field label="Precio (MXN)">
              <TextInput type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
            </Field>
            {error && <p className="text-xs text-wine">{error}</p>}
            <Button type="submit" variant="gold" disabled={createAddon.isPending} className="w-full">
              <Plus size={16} /> {createAddon.isPending ? 'Creando…' : 'Crear extra'}
            </Button>
          </form>
        </Card>
      </div>
    </section>
  );
}

function AddonRow({
  addOn,
  onSave,
  onToggleActivo,
  onDelete,
  saving,
}: {
  addOn: AddOn;
  onSave: (data: AddonPatch) => Promise<unknown>;
  onToggleActivo: () => void;
  onDelete: () => Promise<unknown>;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(addOn.nombre);
  const [kind, setKind] = useState<AddOn['kind']>(addOn.kind);
  const [price, setPrice] = useState(String(addOn.price));

  async function guardar() {
    const priceNum = Number(price);
    if (!nombre.trim() || Number.isNaN(priceNum) || priceNum < 0) return;
    await onSave({ nombre: nombre.trim(), kind, price: priceNum });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="space-y-2 py-3 first:pt-0 last:pb-0">
        <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_0.8fr]">
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
          <SelectInput value={kind} onChange={(e) => setKind(e.target.value as AddOn['kind'])}>
            <option value="fijo">Fijo</option>
            <option value="porPersona">Por persona</option>
            <option value="porUnidad">Por unidad</option>
          </SelectInput>
          <TextInput type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="gold" className="px-3 py-1.5 text-xs" disabled={saving} onClick={guardar}>
            <Save size={13} /> Guardar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => {
              setEditing(false);
              setNombre(addOn.nombre);
              setKind(addOn.kind);
              setPrice(String(addOn.price));
            }}
          >
            Cancela
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div>
        <p className={`font-medium ${addOn.activo ? 'text-ink' : 'text-charcoal-soft line-through'}`}>{addOn.nombre}</p>
        <p className="text-xs text-charcoal-soft">
          {ADDON_KIND_LABEL[addOn.kind]} · {formatMXN(addOn.price)}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => setEditing(true)}>
          <Pencil size={13} /> Editar
        </Button>
        <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={saving} onClick={onToggleActivo}>
          {addOn.activo ? (
            <>
              <X size={13} /> Desactivar
            </>
          ) : (
            <>
              <Check size={13} /> Activar
            </>
          )}
        </Button>
        <ConfirmDelete onConfirm={onDelete} />
      </div>
    </li>
  );
}
