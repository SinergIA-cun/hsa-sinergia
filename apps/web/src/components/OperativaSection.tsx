import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Button, Card, TextInput, SelectInput, Field } from './ui.tsx';
import type { Quote, HojaOperativa, Banquetero } from '../lib/types.ts';

const CheckField = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm text-charcoal">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-gold" />
    {label}
  </label>
);

/** Hoja operativa por evento: se captura al formalizar; alimenta el contrato,
 *  el documento operativo, el correo diario y el ERP futuro. */
export function OperativaSection({ quote }: { quote: Quote }) {
  const qc = useQueryClient();
  const h = quote.operativa ?? {};
  const [horarioCivil, setHorarioCivil] = useState(quote.horarioCivil ?? '');
  const [horaInicio, setHoraInicio] = useState(quote.horaInicio ?? '');
  const [horaTermino, setHoraTermino] = useState(quote.horaTermino ?? '');
  const [hoja, setHoja] = useState<HojaOperativa>(h);
  const [banqueteroId, setBanqueteroId] = useState(quote.banqueteroId ?? '');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const { data: banqData } = useQuery({
    queryKey: ['banqueteros'],
    queryFn: () => api.get<{ banqueteros: Banquetero[] }>('/api/banqueteros'),
  });
  const banqueteros = banqData?.banqueteros ?? [];

  const set = <K extends keyof HojaOperativa>(k: K, v: HojaOperativa[K]) => setHoja((p) => ({ ...p, [k]: v }));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSaved(false);
    try {
      await api.patch(`/api/quotes/${quote.id}/operativa`, {
        horarioCivil: horarioCivil || null,
        horaInicio: horaInicio || null,
        horaTermino: horaTermino || null,
        banqueteroId: banqueteroId || null,
        hoja,
      });
      await qc.invalidateQueries({ queryKey: ['quote', quote.id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setErr('No se pudieron guardar los datos operativos.');
    }
  }

  return (
    <Card className="mt-6 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-xl text-ink">Datos operativos (hoja del evento)</h3>
          <p className="text-sm text-charcoal-soft">Se imprimen en el contrato y en la hoja operativa interna.</p>
        </div>
        <Link to={`/cotizaciones/${quote.id}/operativa`}>
          <Button variant="outline">
            <ClipboardList size={15} /> Ver hoja operativa
          </Button>
        </Link>
      </div>

      <form onSubmit={guardar} className="grid gap-4 sm:grid-cols-3">
        <Field label="Festejado / título"><TextInput value={hoja.nombreFestejado ?? ''} onChange={(e) => set('nombreFestejado', e.target.value)} placeholder="ej. Alondra" /></Field>
        <Field label="Relación del cliente"><TextInput value={hoja.relacionCliente ?? ''} onChange={(e) => set('relacionCliente', e.target.value)} placeholder="ej. Mamá" /></Field>
        <Field label="Banquetero">
          <SelectInput value={banqueteroId} onChange={(e) => setBanqueteroId(e.target.value)}>
            <option value="">Sin asignar</option>
            {banqueteros.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Horario civil"><TextInput value={horarioCivil} onChange={(e) => setHorarioCivil(e.target.value)} placeholder="ej. 14:00" /></Field>
        <Field label="Hora misa"><TextInput value={hoja.horaMisa ?? ''} onChange={(e) => set('horaMisa', e.target.value)} placeholder="ej. 19:00" /></Field>
        <div />
        <Field label="Hora inicio"><TextInput value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} placeholder="ej. 20:30" /></Field>
        <Field label="Hora término"><TextInput value={horaTermino} onChange={(e) => setHoraTermino(e.target.value)} placeholder="ej. 02:30" /></Field>
        <Field label="Habitación (hora)"><TextInput value={hoja.habitacion ?? ''} onChange={(e) => set('habitacion', e.target.value)} placeholder="ej. 17:00" /></Field>

        <Field label="Estrado"><TextInput value={hoja.estrado ?? ''} onChange={(e) => set('estrado', e.target.value)} placeholder="Normal / Izquierda" /></Field>
        <Field label="Pista"><TextInput value={hoja.pista ?? ''} onChange={(e) => set('pista', e.target.value)} placeholder="Sí / Izquierda" /></Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <CheckField label="Capilla" checked={!!hoja.capilla} onChange={(v) => set('capilla', v)} />
          <CheckField label="Fotografía" checked={!!hoja.fotografia} onChange={(v) => set('fotografia', v)} />
        </div>

        <div className="sm:col-span-3">
          <Field label="Personal HSA (una línea por persona: hora — nombre/rol)">
            <textarea
              value={hoja.personalHsa ?? ''}
              onChange={(e) => set('personalHsa', e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-ink/15 bg-white/70 px-3.5 py-2.5 text-sm text-charcoal focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
              placeholder={'17:00 — Miriam (suplente Gabriel)\n08:00 — Gerardo\n17:00 — Jefe de área'}
            />
          </Field>
        </div>

        <Field label="Seguridad — hora"><TextInput value={hoja.personalSeguridadHora ?? ''} onChange={(e) => set('personalSeguridadHora', e.target.value)} placeholder="ej. 17:00" /></Field>
        <Field label="Seguridad — elementos"><TextInput type="number" min="0" value={hoja.personalSeguridadElementos ?? ''} onChange={(e) => set('personalSeguridadElementos', e.target.value ? Number(e.target.value) : undefined)} /></Field>
        <div className="flex items-end pb-1"><CheckField label="Limpieza nocturna y profunda" checked={!!hoja.limpiezaNocturna} onChange={(v) => set('limpiezaNocturna', v)} /></div>

        <Field label="Se queda equipo"><TextInput value={hoja.seQuedaEquipo ?? ''} onChange={(e) => set('seQuedaEquipo', e.target.value)} /></Field>
        <Field label="Maniobras"><TextInput value={hoja.maniobras ?? ''} onChange={(e) => set('maniobras', e.target.value)} /></Field>
        <div className="flex items-end pb-1"><CheckField label="Banquetero es Paq. HSA" checked={!!hoja.banqueteroPaqHsa} onChange={(v) => set('banqueteroPaqHsa', v)} /></div>

        <div className="sm:col-span-3">
          {err && <p className="mb-2 text-sm text-wine">{err}</p>}
          {saved && <p className="mb-2 text-sm text-gold">Datos operativos guardados.</p>}
          <Button type="submit" variant="primary">Guardar hoja operativa</Button>
        </div>
      </form>
    </Card>
  );
}
