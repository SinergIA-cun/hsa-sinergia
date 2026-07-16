import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Card, ArrowDivider, Button } from '../components/ui.tsx';
import { STATUS_LABEL } from '../lib/status.ts';
import type { AgendaEvent, Catalog } from '../lib/types.ts';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const pad = (n: number) => String(n).padStart(2, '0');
const hoyISO = new Date().toISOString().slice(0, 10);

// Orden operativo de espacios: Cúpula → Arcos → Campos → (otros).
const SPACE_ORDER = ['cúpula', 'arcos', 'campos'];
function spacePriority(nombre: string): number {
  const n = nombre.toLowerCase();
  const idx = SPACE_ORDER.findIndex((s) => n.includes(s));
  return idx === -1 ? SPACE_ORDER.length : idx;
}
/** Espacio "principal" del evento = el de mayor prioridad operativa. */
function primarySpace(e: AgendaEvent, nombreById: Map<string, string>): { nombre: string; prio: number } {
  let best = { nombre: '', prio: SPACE_ORDER.length + 1 };
  for (const id of e.spaceIds) {
    const nombre = nombreById.get(id) ?? '';
    const prio = spacePriority(nombre);
    if (prio < best.prio) best = { nombre, prio };
  }
  return best;
}

// Colores de la agenda por estado (cortesía familiar manda sobre todo):
//  vino = tentativa · azul = apartada · blanco/negro = contratado · verde = cortesía.
function agendaChipStyle(e: AgendaEvent): string {
  if (e.esCortesia) return 'bg-emerald-600 text-cream';
  if (e.status === 'formalizada' || e.status === 'liquidada') return 'bg-white text-ink ring-1 ring-ink';
  if (e.status === 'apartada') return 'bg-blue-600 text-white';
  return 'bg-wine/15 text-wine ring-1 ring-wine/25';
}

const LEYENDA: { label: string; dot: string }[] = [
  { label: 'Tentativa', dot: 'bg-wine' },
  { label: 'Apartada', dot: 'bg-blue-600' },
  { label: 'Contratado', dot: 'bg-white ring-1 ring-ink' },
  { label: 'Cortesía familiar', dot: 'bg-emerald-600' },
];

/** El mes visible vive en la URL (?m=YYYY-MM) para que "atrás" del navegador
 *  regrese al mismo mes en vez de reiniciar a hoy. */
function parseMesParam(v: string | null): { anio: number; mes: number } {
  const m = v ? /^(\d{4})-(\d{2})$/.exec(v) : null;
  if (m) return { anio: Number(m[1]), mes: Number(m[2]) - 1 };
  const d = new Date();
  return { anio: d.getFullYear(), mes: d.getMonth() };
}

export function AgendaPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mes = parseMesParam(params.get('m'));
  const mesParam = `${mes.anio}-${pad(mes.mes + 1)}`;

  const primerDiaSemana = (new Date(mes.anio, mes.mes, 1).getDay() + 6) % 7; // 0=Lun (semana inicia lunes)
  const diasEnMes = new Date(mes.anio, mes.mes + 1, 0).getDate();
  const from = `${mes.anio}-${pad(mes.mes + 1)}-01`;
  const to = `${mes.anio}-${pad(mes.mes + 1)}-${pad(diasEnMes)}`;

  const agendaQ = useQuery({
    queryKey: ['agenda', from, to],
    queryFn: () => api.get<{ events: AgendaEvent[] }>(`/api/agenda?from=${from}&to=${to}`),
  });
  const catalogQ = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<Catalog>('/api/catalog'),
  });

  const nombreById = useMemo(
    () => new Map((catalogQ.data?.spaces ?? []).map((s) => [s.id, s.nombre])),
    [catalogQ.data],
  );

  const porDia = useMemo(() => {
    const m = new Map<string, AgendaEvent[]>();
    (agendaQ.data?.events ?? []).forEach((e) => {
      const key = e.fechaEvento.slice(0, 10);
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    });
    // Dentro de cada día ordena por espacio: Cúpula → Arcos → Campos.
    for (const arr of m.values()) {
      arr.sort((a, b) => primarySpace(a, nombreById).prio - primarySpace(b, nombreById).prio);
    }
    return m;
  }, [agendaQ.data, nombreById]);

  // Reemplaza el ?m (replace) para no llenar el historial con cada cambio de mes.
  function setMes(anio: number, mesIdx: number) {
    const next = new URLSearchParams(params);
    next.set('m', `${anio}-${pad(mesIdx + 1)}`);
    setParams(next, { replace: true });
  }
  function cambiarMes(delta: number) {
    const d = new Date(mes.anio, mes.mes + delta, 1);
    setMes(d.getFullYear(), d.getMonth());
  }
  function irHoy() {
    const d = new Date();
    setMes(d.getFullYear(), d.getMonth());
  }

  const tituloRaw = new Date(mes.anio, mes.mes, 1).toLocaleDateString('es-MX', {
    month: 'long',
    year: 'numeric',
  });
  const titulo = tituloRaw.charAt(0).toUpperCase() + tituloRaw.slice(1);

  // Celdas: blancos iniciales + días del mes.
  const celdas: (number | null)[] = [
    ...Array.from({ length: primerDiaSemana }, () => null),
    ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
  ];

  // Al abrir una cotización, lleva el mes de origen para poder regresar aquí.
  function abrir(quoteId: string) {
    navigate(`/cotizaciones/${quoteId}?volver=agenda&m=${mesParam}`);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>Disponibilidad</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">{titulo}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">
            <ChevronLeft size={16} />
          </Button>
          <Button variant="ghost" onClick={irHoy}>Hoy</Button>
          <Button variant="outline" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-cream-300 bg-cream-100 text-center text-xs font-semibold uppercase tracking-wide text-charcoal-soft">
          {DIAS.map((d) => (
            <div key={d} className="py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {celdas.map((dia, i) => {
            if (dia === null) return <div key={`b${i}`} className="min-h-[6rem] border-b border-r border-cream-200 bg-cream-50/40" />;
            const fecha = `${mes.anio}-${pad(mes.mes + 1)}-${pad(dia)}`;
            const eventos = porDia.get(fecha) ?? [];
            const esHoy = fecha === hoyISO;
            return (
              <div key={fecha} className="min-h-[6rem] border-b border-r border-cream-200 p-1.5">
                <div className={`mb-1 text-right text-xs ${esHoy ? 'font-bold text-gold' : 'text-charcoal-soft'}`}>
                  {esHoy ? <span className="rounded-full bg-gold px-1.5 py-0.5 text-cream">{dia}</span> : dia}
                </div>
                <div className="space-y-1">
                  {eventos.map((e) => {
                    const espacio = primarySpace(e, nombreById).nombre;
                    return (
                      <button
                        key={e.quoteId}
                        onClick={() => abrir(e.quoteId)}
                        title={`${espacio || e.eventoNombre} · ${e.cliente} · ${e.eventoNombre} · ${
                          e.esCortesia ? 'Cortesía familiar' : STATUS_LABEL[e.status]
                        }`}
                        className={`block w-full rounded px-1.5 py-1 text-left text-[0.7rem] leading-tight ${agendaChipStyle(e)}`}
                      >
                        <span className="block truncate font-semibold">{espacio || e.eventoNombre}</span>
                        <span className="block truncate opacity-80">{e.cliente}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {agendaQ.isLoading && <p className="mt-4 text-sm text-charcoal-soft">Cargando…</p>}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-charcoal-soft">
        {LEYENDA.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${l.dot}`} />
            {l.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-charcoal-soft">
        El chip muestra el espacio (Cúpula → Arcos → Campos). Toca un evento para abrir su contrato.
      </p>
    </div>
  );
}
