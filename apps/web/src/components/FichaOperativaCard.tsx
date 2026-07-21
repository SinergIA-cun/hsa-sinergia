import { CalendarDays, Clock, Users, Camera, Music2, Truck, Moon, BedDouble } from 'lucide-react';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import type { FichaSemana, Semaforo } from '../lib/types.ts';

const SEMAFORO: Record<Semaforo, { dot: string; ring: string; label: string; text: string }> = {
  verde: { dot: 'bg-emerald-600', ring: 'ring-emerald-600/30', label: 'Lista', text: 'text-emerald-700' },
  amarillo: { dot: 'bg-gold', ring: 'ring-gold/30', label: 'Falta algo', text: 'text-gold' },
  rojo: { dot: 'bg-wine', ring: 'ring-wine/30', label: 'Atención', text: 'text-wine' },
};

const si = (v: boolean) => (v ? 'Sí' : 'No');
const dash = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : String(v));

/** Un dato etiquetado (label chico en mayúsculas + valor). */
function Campo({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <p className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-charcoal-soft/70">{label}</p>
      <p className="text-sm text-ink">{children}</p>
    </div>
  );
}

function SeccionTitulo({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-1 flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-gold">
      {icon}
      {children}
    </p>
  );
}

/** Ficha operativa completa de un evento (misma información que el PDF semanal). */
export function FichaOperativaCard({ f, onOpen }: { f: FichaSemana; onOpen?: () => void }) {
  const s = SEMAFORO[f.semaforo];
  const h = f.hoja;
  const festejado = h.nombreFestejado ? ` · ${h.nombreFestejado}` : '';
  const relacion = h.relacionCliente ? ` — ${h.relacionCliente}` : '';

  const finBadge = f.finiquito.pagado
    ? { txt: 'Finiquito pagado', cls: 'bg-emerald-600/12 text-emerald-700 ring-emerald-600/25' }
    : f.finiquito.pendiente
      ? { txt: `Finiquito pendiente · ${formatMXN(f.finiquito.restante)}`, cls: 'bg-wine/12 text-wine ring-wine/25' }
      : { txt: 'Finiquito al día', cls: 'bg-gold/12 text-gold ring-gold/25' };

  return (
    <article className={`overflow-hidden rounded-[var(--radius-card)] bg-white shadow-sm ring-1 ${s.ring} print:break-inside-avoid`}>
      {/* Encabezado */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-cream-200 bg-cream-50/60 px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} title={s.label} />
            <h3 className="truncate font-display text-lg text-ink">
              {f.evento}
              {festejado}
            </h3>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-charcoal-soft">
            <CalendarDays size={12} /> {formatEventDate(f.fechaEventoISO, 'long')} · {f.espacio}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ring-1 ${finBadge.cls}`}>
            {finBadge.txt}
          </span>
          {onOpen && (
            <button onClick={onOpen} className="text-[0.7rem] font-medium text-ink/60 underline-offset-2 hover:text-ink hover:underline print:hidden">
              Abrir contrato
            </button>
          )}
        </div>
      </header>

      <div className="px-5 py-4">
        {/* Datos generales */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          <Campo label="Cliente" wide>
            {f.cliente}
            <span className="text-charcoal-soft">{relacion}</span>
          </Campo>
          <Campo label="Invitados">
            <span className="inline-flex items-center gap-1">
              <Users size={12} className="text-charcoal-soft" /> {f.invitados}
            </span>
          </Campo>
          <Campo label="Capilla">{f.usaCapilla ? (f.capillaHorario ? `Sí · ${f.capillaHorario}` : 'Sí') : 'No'}</Campo>
        </div>

        {/* Horarios */}
        <SeccionTitulo icon={<Clock size={12} />}>Horarios</SeccionTitulo>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          <Campo label="Misa">{dash(h.horaMisa)}</Campo>
          <Campo label="Civil">{dash(f.horarioCivil)}</Campo>
          <Campo label="Inicio">{dash(f.horaInicio)}</Campo>
          <Campo label="Término">{dash(f.horaTermino)}</Campo>
          <Campo label="Horas del evento">{dash(f.horasEvento)}</Campo>
          <Campo label="Fotografía">
            <span className="inline-flex items-center gap-1">
              <Camera size={12} className="text-charcoal-soft" /> {si(h.fotografia)}
            </span>
          </Campo>
          <Campo label="Costo × hora extra" wide>{formatMXN(f.costoHoraExtra)}</Campo>
        </div>

        {/* Montaje y personal */}
        <SeccionTitulo icon={<Music2 size={12} />}>Montaje y personal</SeccionTitulo>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          <Campo label="Banquetero" wide>
            {dash(h.banquetero)}
            {h.banqueteroPaqHsa && <span className="text-charcoal-soft"> · Paq. HSA</span>}
          </Campo>
          <Campo label="Estrado">{dash(h.estrado)}</Campo>
          <Campo label="Pista">{dash(h.pista)}</Campo>
          <Campo label="Personal HSA" wide>
            <span className="whitespace-pre-wrap">{dash(h.personalHsa)}</span>
          </Campo>
          <Campo label="Seguridad" wide>
            {h.personalSeguridadHora || h.personalSeguridadElementos != null
              ? `${dash(h.personalSeguridadHora)} · ${dash(h.personalSeguridadElementos)} elementos`
              : '—'}
          </Campo>
        </div>

        {/* Cierre */}
        <SeccionTitulo icon={<Truck size={12} />}>Cierre y logística</SeccionTitulo>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          <Campo label="Limpieza nocturna">
            <span className="inline-flex items-center gap-1">
              <Moon size={12} className="text-charcoal-soft" /> {si(h.limpiezaNocturna)}
            </span>
          </Campo>
          <Campo label="Habitación">
            <span className="inline-flex items-center gap-1">
              <BedDouble size={12} className="text-charcoal-soft" /> {dash(h.habitacion)}
            </span>
          </Campo>
          <Campo label="Se queda equipo">{dash(h.seQuedaEquipo)}</Campo>
          {h.maniobras && <Campo label="Maniobras">Sí</Campo>}
          {h.anotaciones && <Campo label="Anotaciones">{h.anotaciones}</Campo>}
        </div>

        {/* Atención: faltantes + finiquito */}
        {(f.faltantes.length > 0 || f.finiquito.pendiente) && (
          <div className={`mt-4 rounded-lg px-3 py-2 text-xs ${f.semaforo === 'rojo' ? 'bg-wine/[0.06]' : 'bg-gold/[0.08]'}`}>
            <span className={`font-semibold ${s.text}`}>{s.label}:</span>{' '}
            <span className="text-charcoal">
              {[
                f.finiquito.pendiente ? `finiquito sin pagar (restan ${formatMXN(f.finiquito.restante)})` : null,
                ...f.faltantes.map((x) => `falta ${x}`),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
