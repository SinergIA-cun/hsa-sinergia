import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Mail, Pencil, Percent, Phone, Save, X } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../auth/auth.tsx';
import { Button, Card, Field, SelectInput, TextInput } from '../ui.tsx';
import { TIPOS_PROFESIONAL, TIPO_PROFESIONAL, type TipoProfesional } from '@hsa/shared';
import { apiErrorMessage } from '../admin/shared.tsx';
import type { Banquetero } from '../../lib/types.ts';

interface Props {
  banqueteroId: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  tipo?: TipoProfesional;
  /** Comisión de HSA por el paquete de alimentos de sus eventos (21-oct-2026). */
  comisionPct?: number;
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
export function ContactoBanquetero({ banqueteroId, nombre, telefono, correo, tipo = 'banquetero', comisionPct = 10, onGuardado }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [editando, setEditando] = useState(false);
  const inicial = { nombre, tipo, telefono: telefono ?? '', correo: correo ?? '', comision: String(comisionPct) };
  const [form, setForm] = useState(inicial);
  const comisionValida = form.comision.trim() !== '' && Number(form.comision) >= 0 && Number(form.comision) <= 100;
  const [error, setError] = useState('');

  const guardar = useMutation({
    mutationFn: () =>
      api.patch<{ banquetero: Banquetero }>(`/api/admin/banqueteros/${banqueteroId}`, {
        nombre: form.nombre.trim(),
        tipo: form.tipo,
        telefono: form.telefono.trim() || null,
        correo: form.correo.trim() || null,
        comisionPct: Number(form.comision),
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
    if (!form.nombre.trim() || !form.telefono.trim() || !comisionValida) return;
    guardar.mutate();
  }

  if (!editando) {
    return (
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
            {TIPO_PROFESIONAL[tipo].label}
          </span>
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
          <span className="inline-flex items-center gap-1.5 text-charcoal-soft" title="Comisión de HSA por el paquete de alimentos de sus eventos">
            <Percent size={14} className="text-gold" /> Comisión HSA {comisionPct}%
          </span>
        </div>
        {isAdmin && (
          <Button
            type="button"
            variant="outline"
            className="px-3 py-1.5 text-xs"
            onClick={() => setEditando(true)}
          >
            <Pencil size={13} /> Editar datos
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="mb-6 p-5">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-5">
        <Field label="Nombre">
          <TextInput
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
          />
        </Field>
        <Field label="Tipo">
          <SelectInput value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoProfesional }))}>
            {TIPOS_PROFESIONAL.map((t) => (
              <option key={t} value={t}>{TIPO_PROFESIONAL[t].label}</option>
            ))}
          </SelectInput>
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
        <Field label="Comisión HSA (%)" hint="Por el paquete de alimentos de sus eventos.">
          <TextInput
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={form.comision}
            onChange={(e) => setForm((f) => ({ ...f, comision: e.target.value }))}
            className={comisionValida ? undefined : 'border-wine'}
          />
        </Field>
      </form>
      {error && <p className="mt-3 text-sm text-wine">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          variant="gold"
          className="px-3 py-1.5 text-xs"
          disabled={guardar.isPending || !form.nombre.trim() || !form.telefono.trim() || !comisionValida}
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
            setForm(inicial);
          }}
        >
          <X size={13} /> Cancela
        </Button>
      </div>
    </Card>
  );
}
