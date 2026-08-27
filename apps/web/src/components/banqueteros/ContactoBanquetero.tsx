import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Mail, Pencil, Phone, Save, X } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../auth/auth.tsx';
import { Button, Card, Field, TextInput } from '../ui.tsx';
import { apiErrorMessage } from '../admin/shared.tsx';
import type { Banquetero } from '../../lib/types.ts';

interface Props {
  banqueteroId: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  onGuardado: () => Promise<void>;
}

/**
 * Los datos de contacto del banquetero, editables desde su ficha.
 *
 * Vive aquí y NO en la lista a propósito: dos formularios que escriben el mismo
 * dato son dos formularios que se desincronizan, y este proyecto ya retiró un par
 * por esa razón. La lista lista; la ficha edita.
 *
 * El teléfono se pide como obligatorio —de estos señores depende dinero y hay que
 * poder hablarles— pero los que ya existían sin él no se bloquean: se marcan como
 * incompletos hasta que alguien capture el de verdad. Un teléfono inventado para
 * cumplir una validación se ve igual que uno real, y es peor.
 */
export function ContactoBanquetero({ banqueteroId, nombre, telefono, correo, onGuardado }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ nombre, telefono: telefono ?? '', correo: correo ?? '' });
  const [error, setError] = useState('');

  const guardar = useMutation({
    mutationFn: () =>
      api.patch<{ banquetero: Banquetero }>(`/api/admin/banqueteros/${banqueteroId}`, {
        nombre: form.nombre.trim(),
        telefono: form.telefono.trim() || null,
        correo: form.correo.trim() || null,
      }),
    onSuccess: async () => {
      setError('');
      setEditando(false);
      await onGuardado();
    },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo guardar.')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim() || !form.telefono.trim()) return;
    guardar.mutate();
  }

  if (!editando) {
    return (
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span
            className={`inline-flex items-center gap-1.5 ${
              telefono ? 'text-ink' : 'font-medium text-wine'
            }`}
          >
            {telefono ? <Phone size={14} className="text-gold" /> : <AlertTriangle size={14} />}
            {telefono ?? 'Sin teléfono'}
          </span>
          <span className="inline-flex items-center gap-1.5 text-charcoal-soft">
            <Mail size={14} /> {correo ?? 'Sin correo'}
          </span>
        </div>
        {isAdmin && (
          <Button
            type="button"
            variant="outline"
            className="px-3 py-1.5 text-xs"
            onClick={() => setEditando(true)}
          >
            <Pencil size={13} /> Editar contacto
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="mb-6 p-5">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-3">
        <Field label="Nombre">
          <TextInput
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
          />
        </Field>
        <Field label="Teléfono" hint="Obligatorio.">
          <TextInput
            autoFocus
            value={form.telefono}
            onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
            placeholder="ej. 55 1234 5678"
            className={form.telefono.trim() ? undefined : 'border-wine'}
          />
        </Field>
        <Field label="Correo (opcional)">
          <TextInput
            type="email"
            value={form.correo}
            onChange={(e) => setForm((f) => ({ ...f, correo: e.target.value }))}
            placeholder="ej. contacto@banquetes.mx"
          />
        </Field>
      </form>
      {error && <p className="mt-3 text-sm text-wine">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          variant="gold"
          className="px-3 py-1.5 text-xs"
          disabled={guardar.isPending || !form.nombre.trim() || !form.telefono.trim()}
          onClick={onSubmit}
        >
          <Save size={13} /> {guardar.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="px-3 py-1.5 text-xs"
          onClick={() => {
            setEditando(false);
            setError('');
            setForm({ nombre, telefono: telefono ?? '', correo: correo ?? '' });
          }}
        >
          <X size={13} /> Cancela
        </Button>
      </div>
    </Card>
  );
}
