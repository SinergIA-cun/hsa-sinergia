import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Save, Check, X, Plus } from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { Button, Card, Field, TextInput, SelectInput, ArrowDivider } from '../components/ui.tsx';
import type { AddOn, AdminConfig, User } from '../lib/types.ts';

const ADDON_KIND_LABEL: Record<AddOn['kind'], string> = {
  fijo: 'Fijo',
  porPersona: 'Por persona',
  porUnidad: 'Por unidad',
};

const ROLE_LABEL: Record<User['role'], string> = {
  admin: 'Admin',
  vendedora: 'Vendedora',
};

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}

export function AdminPage() {
  return (
    <div className="space-y-10">
      <div>
        <ArrowDivider>Administración</ArrowDivider>
        <h1 className="mt-2 font-display text-4xl text-ink">Panel de admin</h1>
      </div>
      <UsersSection />
      <AddonsSection />
      <ConfigSection />
    </div>
  );
}

function UsersSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: User[] }>('/api/users'),
  });
  const users = data?.users ?? [];

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<User['role']>('vendedora');
  const [error, setError] = useState('');

  const createUser = useMutation({
    mutationFn: () =>
      api.post<{ user: User }>('/api/users', { nombre, email, password, role }),
    onSuccess: async () => {
      setNombre('');
      setEmail('');
      setPassword('');
      setRole('vendedora');
      setError('');
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Ya existe un usuario con ese correo'
          : apiErrorMessage(err, 'No se pudo crear el usuario.'),
      );
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nombre || !email || password.length < 8) {
      setError('Completa nombre, correo y una contraseña de al menos 8 caracteres.');
      return;
    }
    createUser.mutate();
  }

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl text-ink">Usuarios</h2>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-6">
          {isLoading && <p className="text-sm text-charcoal-soft">Cargando…</p>}
          {!isLoading && users.length === 0 && (
            <p className="text-sm text-charcoal-soft">Aún no hay usuarios registrados.</p>
          )}
          {!isLoading && users.length > 0 && (
            <ul className="divide-y divide-cream-300">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-medium text-ink">{u.nombre}</p>
                    <p className="text-xs text-charcoal-soft">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!u.activo && (
                      <span className="rounded-full bg-wine/10 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-wine">
                        Inactivo
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${
                        u.role === 'admin' ? 'bg-gold/15 text-gold' : 'bg-ink/10 text-ink'
                      }`}
                    >
                      {ROLE_LABEL[u.role]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4 p-6">
          <h3 className="font-display text-lg text-ink">Nueva vendedora</h3>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Nombre">
              <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre completo" />
            </Field>
            <Field label="Correo">
              <TextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@haciendasanandres.com.mx"
              />
            </Field>
            <Field label="Contraseña" hint="Mínimo 8 caracteres">
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
            <Field label="Rol">
              <SelectInput value={role} onChange={(e) => setRole(e.target.value as User['role'])}>
                <option value="vendedora">Vendedora</option>
                <option value="admin">Admin</option>
              </SelectInput>
            </Field>
            {error && <p className="text-xs text-wine">{error}</p>}
            <Button type="submit" variant="gold" disabled={createUser.isPending} className="w-full">
              <UserPlus size={16} /> {createUser.isPending ? 'Creando…' : 'Crear usuario'}
            </Button>
          </form>
        </Card>
      </div>
    </section>
  );
}

function AddonsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-addons'],
    queryFn: () => api.get<{ addOns: AddOn[] }>('/api/admin/addons'),
  });
  const addOns = data?.addOns ?? [];

  async function invalidateAddons() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['admin-addons'] }),
      qc.invalidateQueries({ queryKey: ['catalog'] }),
    ]);
  }

  const updateAddon = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<AddOn, 'price' | 'activo'>> }) =>
      api.patch<{ addOn: AddOn }>(`/api/admin/addons/${id}`, data),
    onSuccess: invalidateAddons,
  });

  const [nombre, setNombre] = useState('');
  const [kind, setKind] = useState<AddOn['kind']>('fijo');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  const createAddon = useMutation({
    mutationFn: () =>
      api.post<{ addOn: AddOn }>('/api/admin/addons', { nombre, kind, price: Number(price) }),
    onSuccess: async () => {
      setNombre('');
      setKind('fijo');
      setPrice('');
      setError('');
      await invalidateAddons();
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
                  onSavePrice={(price) => updateAddon.mutate({ id: a.id, data: { price } })}
                  onToggleActivo={() => updateAddon.mutate({ id: a.id, data: { activo: !a.activo } })}
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
              <TextInput
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
              />
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
  onSavePrice,
  onToggleActivo,
  saving,
}: {
  addOn: AddOn;
  onSavePrice: (price: number) => void;
  onToggleActivo: () => void;
  saving: boolean;
}) {
  const [priceInput, setPriceInput] = useState(String(addOn.price));
  const priceNum = Number(priceInput);
  const priceDirty = !Number.isNaN(priceNum) && priceNum !== addOn.price;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div>
        <p className={`font-medium ${addOn.activo ? 'text-ink' : 'text-charcoal-soft line-through'}`}>
          {addOn.nombre}
        </p>
        <p className="text-xs text-charcoal-soft">
          {ADDON_KIND_LABEL[addOn.kind]} · actualmente {formatMXN(addOn.price)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          className="w-24 rounded-md border border-ink/15 px-2 py-1.5 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          disabled={!priceDirty || saving}
          onClick={() => onSavePrice(priceNum)}
          className="px-2.5 py-1.5 text-xs"
        >
          <Save size={13} /> Guardar
        </Button>
        <Button
          type="button"
          variant={addOn.activo ? 'ghost' : 'outline'}
          disabled={saving}
          onClick={onToggleActivo}
          className="px-2.5 py-1.5 text-xs"
        >
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
      </div>
    </li>
  );
}

function ConfigSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => api.get<{ config: AdminConfig }>('/api/admin/config'),
  });
  const config = data?.config;

  const [ivaPct, setIvaPct] = useState('');
  const [extraHourPct, setExtraHourPct] = useState('');
  const [foodDiscountPct, setFoodDiscountPct] = useState('');
  const [valetRatio, setValetRatio] = useState('');
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);

  // Sincroniza los campos con la config recién cargada, sólo antes de que
  // la usuaria empiece a editar (evita pisar cambios en curso).
  useEffect(() => {
    if (!config || touched) return;
    setIvaPct(String(config.ivaRate * 100));
    setExtraHourPct(String(config.extraHourRate * 100));
    setFoodDiscountPct(String(config.foodDiscountRate * 100));
    setValetRatio(String(config.valetRatio));
  }, [config, touched]);

  const saveConfig = useMutation({
    mutationFn: (data: Partial<AdminConfig>) => api.patch<{ config: AdminConfig }>('/api/admin/config', data),
    onSuccess: async () => {
      setError('');
      setTouched(false);
      setSavedAt(Date.now());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin-config'] }),
        qc.invalidateQueries({ queryKey: ['catalog'] }),
      ]);
    },
    onError: (err) => setError(apiErrorMessage(err, 'No se pudo guardar la configuración.')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const iva = Number(ivaPct);
    const extraHour = Number(extraHourPct);
    const foodDiscount = Number(foodDiscountPct);
    const ratio = Number(valetRatio);
    if ([iva, extraHour, foodDiscount, ratio].some((n) => Number.isNaN(n)) || ratio <= 0) {
      setError('Revisa que todos los campos sean números válidos y el valet sea mayor a 0.');
      return;
    }
    setError('');
    saveConfig.mutate({
      ivaRate: iva / 100,
      extraHourRate: extraHour / 100,
      foodDiscountRate: foodDiscount / 100,
      valetRatio: ratio,
    });
  }

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl text-ink">Configuración</h2>
      <Card className="max-w-2xl p-6">
        {isLoading && <p className="text-sm text-charcoal-soft">Cargando…</p>}
        {!isLoading && (
          <form
            onSubmit={onSubmit}
            className="space-y-4"
            onChange={() => setTouched(true)}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="IVA (%)">
                <TextInput type="number" min={0} max={100} step="0.01" value={ivaPct} onChange={(e) => setIvaPct(e.target.value)} />
              </Field>
              <Field label="Hora extra (%)">
                <TextInput
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={extraHourPct}
                  onChange={(e) => setExtraHourPct(e.target.value)}
                />
              </Field>
              <Field label="Descuento por alimentos (%)">
                <TextInput
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={foodDiscountPct}
                  onChange={(e) => setFoodDiscountPct(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Valet: 1 auto por cada N personas" hint="Ej. 2.5 = 1 auto por cada 2.5 invitados">
              <TextInput
                type="number"
                min={0.1}
                step="0.1"
                value={valetRatio}
                onChange={(e) => setValetRatio(e.target.value)}
              />
            </Field>
            {error && <p className="text-xs text-wine">{error}</p>}
            {savedAt && !error && <p className="text-xs text-emerald-700">Configuración guardada.</p>}
            <Button type="submit" variant="gold" disabled={saveConfig.isPending}>
              <Save size={16} /> {saveConfig.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </form>
        )}
      </Card>
    </section>
  );
}
