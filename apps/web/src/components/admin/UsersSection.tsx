import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Save, Pencil } from 'lucide-react';
import { api, ApiError } from '../../lib/api.ts';
import { Button, Card, Field, TextInput, SelectInput } from '../ui.tsx';
import type { User } from '../../lib/types.ts';
import { apiErrorMessage, ConfirmDelete } from './shared.tsx';

const ROLE_LABEL: Record<User['role'], string> = { admin: 'Admin', ventas: 'Ventas' };

type UserPatch = { nombre?: string; role?: User['role']; activo?: boolean; password?: string };

export function UsersSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: User[] }>('/api/users'),
  });
  const users = data?.users ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UserPatch }) =>
      api.patch<{ user: User }>(`/api/users/${id}`, data),
    onSuccess: invalidate,
  });
  const deleteUser = useMutation({
    mutationFn: (id: string) => api.del(`/api/users/${id}`),
    onSuccess: invalidate,
  });

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<User['role']>('ventas');
  const [error, setError] = useState('');

  const createUser = useMutation({
    mutationFn: () => api.post<{ user: User }>('/api/users', { nombre, email, password, role }),
    onSuccess: async () => {
      setNombre('');
      setEmail('');
      setPassword('');
      setRole('ventas');
      setError('');
      await invalidate();
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
                <UserRow
                  key={u.id}
                  user={u}
                  onSave={(data) => updateUser.mutateAsync({ id: u.id, data })}
                  onDelete={() => deleteUser.mutateAsync(u.id)}
                  saving={updateUser.isPending}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4 p-6">
          <h3 className="font-display text-lg text-ink">Nueva usuaria de ventas</h3>
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
              <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </Field>
            <Field label="Rol">
              <SelectInput value={role} onChange={(e) => setRole(e.target.value as User['role'])}>
                <option value="ventas">Ventas</option>
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

function UserRow({
  user: u,
  onSave,
  onDelete,
  saving,
}: {
  user: User;
  onSave: (data: UserPatch) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(u.nombre);
  const [role, setRole] = useState<User['role']>(u.role);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function guardar() {
    if (!nombre.trim()) return;
    if (password && password.length < 8) {
      setError('La contraseña nueva debe tener al menos 8 caracteres.');
      return;
    }
    setError('');
    try {
      await onSave({ nombre: nombre.trim(), role, ...(password ? { password } : {}) });
      setPassword('');
      setEditing(false);
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo guardar.'));
    }
  }

  if (editing) {
    return (
      <li className="space-y-2 py-3 first:pt-0 last:pb-0">
        <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr]">
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
          <SelectInput value={role} onChange={(e) => setRole(e.target.value as User['role'])}>
            <option value="ventas">Ventas</option>
            <option value="admin">Admin</option>
          </SelectInput>
        </div>
        <TextInput
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Nueva contraseña (opcional, mín. 8)"
        />
        {error && <p className="text-xs text-wine">{error}</p>}
        <div className="flex items-center gap-2">
          <Button type="button" variant="gold" className="px-3 py-1.5 text-xs" disabled={saving} onClick={guardar}>
            <Save size={13} /> Guardar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => { setEditing(false); setNombre(u.nombre); setRole(u.role); setPassword(''); setError(''); }}
          >
            Cancela
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className={`font-medium ${u.activo ? 'text-ink' : 'text-charcoal-soft line-through'}`}>{u.nombre}</p>
        <p className="text-xs text-charcoal-soft">{u.email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
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
        <Button type="button" variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => setEditing(true)}>
          <Pencil size={13} /> Editar
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="px-2.5 py-1.5 text-xs"
          disabled={saving}
          onClick={() => onSave({ activo: !u.activo })}
        >
          {u.activo ? 'Desactivar' : 'Activar'}
        </Button>
        <ConfirmDelete onConfirm={onDelete} />
      </div>
    </li>
  );
}
