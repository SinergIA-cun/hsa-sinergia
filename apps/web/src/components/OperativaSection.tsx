import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardList, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { Button, Card, TextInput, TimeInput, SelectInput, Field } from './ui.tsx';
import type { Quote, HojaOperativa, Banquetero, Empleado, Cuadrilla, PersonalHsaRow } from '../lib/types.ts';

/** Filas iniciales del personal: usa las estructuradas o migra el texto legado. */
function filasIniciales(h: HojaOperativa): PersonalHsaRow[] {
  if (h.personalHsaRows && h.personalHsaRows.length > 0) return h.personalHsaRows;
  if (h.personalHsa) return h.personalHsa.split('\n').filter(Boolean).map((linea) => ({ nombre: linea.trim() }));
  return [];
}

const CheckField = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm text-charcoal">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-gold" />
    {label}
  </label>
);

const OTRO = '__otro__';

/** Campo con opciones frecuentes + "Otro…" (texto libre) cuando el valor no está en la lista. */
function ChoiceField({
  label,
  value,
  options,
  onChange,
  otherPlaceholder,
  hint,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  otherPlaceholder?: string;
  hint?: string;
}) {
  const enLista = value !== '' && options.includes(value);
  const [otro, setOtro] = useState(value !== '' && !enLista);
  return (
    <Field label={label} hint={hint}>
      <div className="space-y-2">
        <SelectInput
          value={otro ? OTRO : value}
          onChange={(e) => {
            if (e.target.value === OTRO) { setOtro(true); onChange(''); }
            else { setOtro(false); onChange(e.target.value); }
          }}
        >
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={OTRO}>Otro…</option>
        </SelectInput>
        {otro && (
          <TextInput value={value} onChange={(e) => onChange(e.target.value)} placeholder={otherPlaceholder ?? 'Especifica…'} />
        )}
      </div>
    </Field>
  );
}

/** Convierte "HH:MM" a minutos; null si no aplica. */
function horaAMin(h: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(h);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Hoja operativa por evento: se captura al formalizar; alimenta el contrato,
 *  el documento operativo, el correo diario y el ERP futuro. */
export function OperativaSection({ quote }: { quote: Quote }) {
  const qc = useQueryClient();
  const h = quote.operativa ?? {};
  const [horarioCivil, setHorarioCivil] = useState(quote.horarioCivil ?? '');
  const [horaInicio, setHoraInicio] = useState(quote.horaInicio ?? '');
  const [horaTermino, setHoraTermino] = useState(quote.horaTermino ?? '');
  // Si el contrato usa capilla con horario, se pre-llena la hora de misa con ese horario.
  const capillaHora = quote.usaCapilla ? quote.capillaHorario ?? '' : '';
  const [hoja, setHoja] = useState<HojaOperativa>(() => ({
    ...h,
    horaMisa: h.horaMisa || capillaHora || undefined,
    maniobras: !!h.maniobras, // datos viejos podían venir como texto
  }));
  const [banqueteroId, setBanqueteroId] = useState(quote.banqueteroId ?? '');
  const [personal, setPersonal] = useState<PersonalHsaRow[]>(() => filasIniciales(h));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const { data: banqData } = useQuery({
    queryKey: ['banqueteros'],
    queryFn: () => api.get<{ banqueteros: Banquetero[] }>('/api/banqueteros'),
  });
  const banqueteros = banqData?.banqueteros ?? [];

  const { data: cuadData } = useQuery({
    queryKey: ['cuadrillas'],
    queryFn: () => api.get<{ cuadrillas: Cuadrilla[] }>('/api/cuadrillas'),
  });
  const cuadrillas = cuadData?.cuadrillas ?? [];

  const { data: empData } = useQuery({
    queryKey: ['empleados'],
    queryFn: () => api.get<{ empleados: Empleado[] }>('/api/empleados'),
  });
  const empleados = empData?.empleados ?? [];

  const set = <K extends keyof HojaOperativa>(k: K, v: HojaOperativa[K]) => setHoja((p) => ({ ...p, [k]: v }));

  // Datos del contrato que se muestran auto (sin recapturar) para reducir errores.
  const costoHoraExtra = Math.round(quote.rentaTotal * 0.05);
  // Aviso: término en la tarde/noche (>=6am) pero antes del inicio (no es evento de trasnoche).
  const iniMin = horaAMin(horaInicio);
  const finMin = horaAMin(horaTermino);
  const terminoRaro = iniMin != null && finMin != null && finMin < iniMin && finMin >= 6 * 60;

  // Cargar una cuadrilla agrega sus miembros que aún no estén en la lista.
  function cargarCuadrilla(id: string) {
    const c = cuadrillas.find((x) => x.id === id);
    if (!c) return;
    setPersonal((prev) => {
      const nombres = new Set(prev.map((r) => r.nombre));
      const nuevos = c.miembros
        .filter((m) => !nombres.has(m.empleado.nombre))
        .map((m) => ({ nombre: m.empleado.nombre, rol: m.empleado.rol ?? undefined, hora: '' }));
      return [...prev, ...nuevos];
    });
  }
  function agregarEmpleado(id: string) {
    const e = empleados.find((x) => x.id === id);
    if (!e) return;
    setPersonal((prev) => [...prev, { nombre: e.nombre, rol: e.rol ?? undefined, hora: '' }]);
  }
  const setFila = (i: number, campo: keyof PersonalHsaRow, valor: string) =>
    setPersonal((prev) => prev.map((r, idx) => (idx === i ? { ...r, [campo]: valor } : r)));
  const quitarFila = (i: number) => setPersonal((prev) => prev.filter((_, idx) => idx !== i));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSaved(false);
    try {
      const rows = personal
        .filter((r) => r.nombre.trim())
        .map((r) => ({ nombre: r.nombre.trim(), hora: r.hora || undefined, rol: r.rol || undefined }));
      await api.patch(`/api/quotes/${quote.id}/operativa`, {
        horarioCivil: horarioCivil || null,
        horaInicio: horaInicio || null,
        horaTermino: horaTermino || null,
        banqueteroId: banqueteroId || null,
        hoja: { ...hoja, personalHsaRows: rows },
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
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg bg-ink/[0.03] px-3.5 py-2 text-sm text-charcoal sm:col-span-3">
          <span><span className="text-charcoal-soft">Horas del evento:</span> {quote.horasEvento ?? '—'}</span>
          <span><span className="text-charcoal-soft">Costo × hora extra:</span> {formatMXN(costoHoraExtra)}</span>
          <span className="text-xs text-charcoal-soft">Se calculan del contrato y se imprimen en la hoja.</span>
        </div>

        <Field label="Festejado / título"><TextInput value={hoja.nombreFestejado ?? ''} onChange={(e) => set('nombreFestejado', e.target.value)} placeholder="ej. Alondra" /></Field>
        <ChoiceField
          label="Relación del cliente"
          value={hoja.relacionCliente ?? ''}
          options={['Mamá', 'Papá', 'Novios', 'Festejado', 'Familiar']}
          onChange={(v) => set('relacionCliente', v)}
          otherPlaceholder="ej. Tía"
        />
        <Field label="Banquetero">
          <SelectInput value={banqueteroId} onChange={(e) => setBanqueteroId(e.target.value)}>
            <option value="">Sin asignar</option>
            {banqueteros.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Horario civil"><TimeInput value={horarioCivil} onChange={(e) => setHorarioCivil(e.target.value)} /></Field>
        <Field label="Hora misa" hint={capillaHora ? `Se tomó de la capilla del contrato (${capillaHora})` : undefined}>
          <TimeInput value={hoja.horaMisa ?? ''} onChange={(e) => set('horaMisa', e.target.value)} />
        </Field>
        <div />
        <Field label="Hora inicio"><TimeInput value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} /></Field>
        <Field label="Hora término"><TimeInput value={horaTermino} onChange={(e) => setHoraTermino(e.target.value)} /></Field>
        <Field label="Habitación (hora)"><TimeInput value={hoja.habitacion ?? ''} onChange={(e) => set('habitacion', e.target.value)} /></Field>

        <ChoiceField
          label="Estrado"
          value={hoja.estrado ?? ''}
          options={['Normal', 'Izquierda', 'Derecha']}
          onChange={(v) => set('estrado', v)}
        />
        <ChoiceField
          label="Pista"
          value={hoja.pista ?? ''}
          options={['Sí', 'No', 'LED', 'Izquierda', 'Normal']}
          onChange={(v) => set('pista', v)}
          otherPlaceholder="ej. Recorrer 1/2 hacia baños"
        />
        <div className="flex flex-col justify-end gap-2 pb-1">
          <CheckField label="Capilla" checked={!!hoja.capilla} onChange={(v) => set('capilla', v)} />
          <CheckField label="Fotografía" checked={!!hoja.fotografia} onChange={(v) => set('fotografia', v)} />
        </div>

        <div className="sm:col-span-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink">Personal HSA</span>
            <div className="flex flex-wrap items-center gap-2">
              <SelectInput
                aria-label="Cargar cuadrilla"
                value=""
                onChange={(e) => { if (e.target.value) cargarCuadrilla(e.target.value); }}
                className="w-auto py-1.5 text-sm"
              >
                <option value="">
                  {cuadrillas.length ? 'Cargar cuadrilla…' : 'Sin cuadrillas (créalas en Admin)'}
                </option>
                {cuadrillas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre} ({c.miembros.length})</option>
                ))}
              </SelectInput>
              <SelectInput
                aria-label="Agregar empleado"
                value=""
                onChange={(e) => { if (e.target.value) agregarEmpleado(e.target.value); }}
                className="w-auto py-1.5 text-sm"
              >
                <option value="">Agregar persona…</option>
                {empleados.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.nombre}{emp.rol ? ` · ${emp.rol}` : ''}</option>
                ))}
              </SelectInput>
            </div>
          </div>

          {personal.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink/15 px-3 py-4 text-center text-sm text-charcoal-soft">
              Carga una cuadrilla o agrega personas, y ponles su horario.
            </p>
          ) : (
            <div className="space-y-1.5">
              {personal.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <TimeInput
                    aria-label="Hora"
                    value={r.hora ?? ''}
                    onChange={(e) => setFila(i, 'hora', e.target.value)}
                    className="w-28 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {r.nombre}
                    {r.rol && <span className="text-charcoal-soft"> · {r.rol}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => quitarFila(i)}
                    aria-label={`Quitar ${r.nombre}`}
                    className="shrink-0 rounded-lg p-1.5 text-charcoal-soft transition-colors hover:bg-wine/10 hover:text-wine"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Seguridad — hora"><TimeInput value={hoja.personalSeguridadHora ?? ''} onChange={(e) => set('personalSeguridadHora', e.target.value)} /></Field>
        <Field label="Seguridad — elementos"><TextInput type="number" min="0" value={hoja.personalSeguridadElementos ?? ''} onChange={(e) => set('personalSeguridadElementos', e.target.value ? Number(e.target.value) : undefined)} /></Field>
        <div className="flex items-end pb-1"><CheckField label="Limpieza nocturna y profunda" checked={!!hoja.limpiezaNocturna} onChange={(v) => set('limpiezaNocturna', v)} /></div>

        <Field label="Se queda equipo"><TextInput value={hoja.seQuedaEquipo ?? ''} onChange={(e) => set('seQuedaEquipo', e.target.value)} /></Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <CheckField label="Maniobras" checked={!!hoja.maniobras} onChange={(v) => set('maniobras', v)} />
          <CheckField label="Banquetero es Paq. HSA" checked={!!hoja.banqueteroPaqHsa} onChange={(v) => set('banqueteroPaqHsa', v)} />
        </div>
        <div />

        <div className="sm:col-span-3">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">Anotaciones</span>
          <textarea
            value={hoja.anotaciones ?? ''}
            onChange={(e) => set('anotaciones', e.target.value)}
            rows={2}
            placeholder="Notas libres. Ej. Colgante · Padre Carmelo · Fotos 18:00 · Recorrer pista 1/2 hacia baños"
            className="w-full rounded-lg border border-ink/15 bg-white/70 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-charcoal-soft/60 transition-colors focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
          />
        </div>

        <div className="sm:col-span-3">
          {terminoRaro && (
            <p className="mb-2 text-sm text-wine">
              La hora de término ({horaTermino}) es anterior a la de inicio ({horaInicio}). Revisa si es correcto.
            </p>
          )}
          {err && <p className="mb-2 text-sm text-wine">{err}</p>}
          {saved && <p className="mb-2 text-sm text-gold">Datos operativos guardados.</p>}
          <Button type="submit" variant="primary">Guardar hoja operativa</Button>
        </div>
      </form>
    </Card>
  );
}
