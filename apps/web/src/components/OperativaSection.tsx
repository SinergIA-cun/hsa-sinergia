import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { Button, Card, TextInput, Field } from './ui.tsx';
import type { Quote } from '../lib/types.ts';

/** Datos operativos (horarios) que se capturan al formalizar y alimentan el contrato. */
export function OperativaSection({ quote }: { quote: Quote }) {
  const qc = useQueryClient();
  const [horarioCivil, setHorarioCivil] = useState(quote.horarioCivil ?? '');
  const [horaInicio, setHoraInicio] = useState(quote.horaInicio ?? '');
  const [horaTermino, setHoraTermino] = useState(quote.horaTermino ?? '');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSaved(false);
    try {
      await api.patch(`/api/quotes/${quote.id}/operativa`, {
        horarioCivil: horarioCivil || null,
        horaInicio: horaInicio || null,
        horaTermino: horaTermino || null,
      });
      await qc.invalidateQueries({ queryKey: ['quote', quote.id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setErr('No se pudieron guardar los horarios.');
    }
  }

  return (
    <Card className="mt-6 p-6">
      <h3 className="mb-1 font-display text-xl text-ink">Datos operativos</h3>
      <p className="mb-4 text-sm text-charcoal-soft">Horarios del evento; se imprimen en el contrato.</p>
      <form onSubmit={guardar} className="grid gap-4 sm:grid-cols-3">
        <Field label="Horario civil">
          <TextInput value={horarioCivil} onChange={(e) => setHorarioCivil(e.target.value)} placeholder="ej. 14:00 hrs" />
        </Field>
        <Field label="Hora de inicio">
          <TextInput value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} placeholder="ej. 18:00" />
        </Field>
        <Field label="Hora de término">
          <TextInput value={horaTermino} onChange={(e) => setHoraTermino(e.target.value)} placeholder="ej. 01:00" />
        </Field>
        <div className="sm:col-span-3">
          {err && <p className="mb-2 text-sm text-wine">{err}</p>}
          {saved && <p className="mb-2 text-sm text-gold">Horarios guardados.</p>}
          <Button type="submit" variant="outline">
            Guardar horarios
          </Button>
        </div>
      </form>
    </Card>
  );
}
