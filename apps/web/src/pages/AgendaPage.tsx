import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { computeQuote } from '@hsa/shared';
import { api } from '../lib/api.ts';
import { Card, ArrowDivider, Button } from '../components/ui.tsx';
import { MoverFechaModal } from '../components/MoverFechaModal.tsx';
import { STATUS_LABEL } from '../lib/status.ts';
import type { AgendaEvent, Catalog, QuoteDetail } from '../lib/types.ts';

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
//  vino = tentativa · azul = formalizada (pagó anticipo) · blanco/negro = complemento
//  cubierto o liquidada · verde = cortesía.
function agendaChipStyle(e: AgendaEvent): string {
  if (e.esCortesia) return 'bg-emerald-600 text-cream';
  if (e.status === 'complementada' || e.status === 'liquidada') return 'bg-white text-ink ring-1 ring-ink';
  if (e.status === 'formalizada') return 'bg-blue-600 text-white';
  return 'bg-wine/15 text-wine ring-1 ring-wine/25';
}

const LEYENDA: { label: string; dot: string }[] = [
  { label: 'Tentativa', dot: 'bg-wine' },
  { label: 'Formalizada', dot: 'bg-blue-600' },
  { label: 'Complemento cubierto', dot: 'bg-white ring-1 ring-ink' },
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

  // El chip es a la vez botón (abrir el contrato) y asa de arrastre, y esos dos
  // se pelean: en cuanto @dnd-kit activa un arrastre instala un listener de
  // `click` en captura que lo cancela. Sin restricción de activación el
  // arrastre arranca en el mismo `pointerdown`, así que TODO toque quedaría
  // muerto y nunca se abriría el evento. Con 8 px de umbral el toque (que no
  // llega ni a la tolerancia táctil del sistema) nunca activa el arrastre y el
  // clic pasa limpio; a partir de 8 px sí es un arrastre deliberado.
  // Solo PointerSensor a propósito: KeyboardSensor secuestraría Enter/Espacio
  // del botón, que es como el teclado abre el evento.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const [mover, setMover] = useState<{
    quoteId: string; cliente: string; origen: string; destino: string;
    totalActual: number; totalNuevo: number | null; pagado: number;
  } | null>(null);
  const [moviendo, setMoviendo] = useState(false);
  const [errorMover, setErrorMover] = useState('');

  // Al soltar, se pide la cotización y se calcula el total de la fecha nueva
  // EN EL NAVEGADOR con el mismo motor que usa el servidor, para poder mostrar
  // el cambio de precio antes de confirmar.
  async function onDragEnd(ev: DragEndEvent) {
    const quoteId = String(ev.active.id);
    const destino = ev.over ? String(ev.over.id) : null;
    if (!destino) return;
    const evento = (agendaQ.data?.events ?? []).find((e) => e.quoteId === quoteId);
    if (!evento) return;
    const origen = evento.fechaEvento.slice(0, 10);
    if (origen === destino) return;

    setErrorMover('');
    const detalle = await api.get<QuoteDetail>(`/api/quotes/${quoteId}`);
    let totalNuevo: number | null = null;
    if (catalogQ.data) {
      try {
        totalNuevo = Math.round(
          computeQuote(catalogQ.data.engine, {
            fecha: destino,
            invitados: detalle.quote.invitados,
            spaceIds: detalle.quote.spaceIds,
            horasExtra: detalle.quote.horasExtra,
            usaCapilla: detalle.quote.usaCapilla ?? false,
            usaDjHoraExtra: detalle.quote.usaDjHoraExtra ?? false,
            eventTypeId: detalle.quote.eventTypeId,
            foodPackageId: detalle.quote.foodPackageId ?? undefined,
            addOns: detalle.quote.addOns ?? [],
          }).total,
        );
      } catch {
        totalNuevo = null; // p. ej. el espacio no tiene precio para ese día
      }
    }

    setMover({
      quoteId,
      cliente: evento.cliente,
      origen,
      destino,
      totalActual: detalle.quote.total,
      totalNuevo,
      pagado: detalle.estadoCuenta.pagado,
    });
  }

  async function confirmarMover() {
    if (!mover) return;
    setMoviendo(true);
    setErrorMover('');
    try {
      await api.patch(`/api/quotes/${mover.quoteId}/fecha`, { fecha: mover.destino });
      await agendaQ.refetch();
      setMover(null);
    } catch (e) {
      setErrorMover(e instanceof Error ? e.message : 'No se pudo mover el evento.');
    } finally {
      setMoviendo(false);
    }
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

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
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
                <CeldaSoltable key={fecha} fecha={fecha}>
                  <div className={`mb-1 text-right text-xs ${esHoy ? 'font-bold text-gold' : 'text-charcoal-soft'}`}>
                    {esHoy ? <span className="rounded-full bg-gold px-1.5 py-0.5 text-cream">{dia}</span> : dia}
                  </div>
                  <div className="space-y-1">
                    {eventos.map((e) => {
                      const espacio = primarySpace(e, nombreById).nombre;
                      return (
                        <ChipArrastrable
                          key={e.quoteId}
                          id={e.quoteId}
                          movible={e.status !== 'liquidada' && e.status !== 'vencida'}
                          onClick={() => abrir(e.quoteId)}
                          title={`${espacio || e.eventoNombre} · ${e.cliente} · ${e.eventoNombre} · ${
                            e.esCortesia ? 'Cortesía familiar' : STATUS_LABEL[e.status]
                          }`}
                          className={`block w-full rounded px-1.5 py-1 text-left text-[0.7rem] leading-tight ${agendaChipStyle(e)}`}
                        >
                          <span className="block truncate font-semibold">{espacio || e.eventoNombre}</span>
                          <span className="block truncate opacity-80">{e.cliente}</span>
                        </ChipArrastrable>
                      );
                    })}
                  </div>
                </CeldaSoltable>
              );
            })}
          </div>
        </Card>
      </DndContext>

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
        El chip muestra el espacio (Cúpula → Arcos → Campos). Toca un evento para abrir su
        contrato, o arrástralo a otro día para cambiarle la fecha.
      </p>

      {mover && (
        <MoverFechaModal
          cliente={mover.cliente}
          fechaOrigen={mover.origen}
          fechaDestino={mover.destino}
          totalActual={mover.totalActual}
          totalNuevo={mover.totalNuevo}
          pagado={mover.pagado}
          busy={moviendo}
          error={errorMover}
          onCancel={() => setMover(null)}
          onConfirm={confirmarMover}
        />
      )}
    </div>
  );
}

/** Un evento arrastrable. Los liquidados y vencidos no se mueven. */
function ChipArrastrable({ id, movible, className, title, onClick, children }: {
  id: string; movible: boolean; className: string; title: string;
  onClick: () => void; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !movible });
  // `attributes` se aplica solo si el chip se puede arrastrar: cuando está
  // desactivado trae `aria-disabled="true"`, y el chip de un evento liquidado
  // NO está desactivado — sigue abriendo su contrato al tocarlo. Anunciarlo
  // como deshabilitado haría que el lector de pantalla lo diera por muerto.
  return (
    <button
      ref={setNodeRef}
      {...(movible ? { ...listeners, ...attributes } : {})}
      onClick={onClick}
      title={title}
      className={`${className} ${isDragging ? 'opacity-40' : ''} ${movible ? 'cursor-grab' : ''}`}
    >
      {children}
    </button>
  );
}

/** Una celda de día que acepta eventos soltados encima. */
function CeldaSoltable({ fecha, children }: { fecha: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: fecha });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[6rem] border-b border-r border-cream-200 p-1.5 ${isOver ? 'bg-gold/10 ring-1 ring-inset ring-gold' : ''}`}
    >
      {children}
    </div>
  );
}
