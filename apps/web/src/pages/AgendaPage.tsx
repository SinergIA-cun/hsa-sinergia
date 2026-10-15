import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { computeQuote } from '@hsa/shared';
import { api } from '../lib/api.ts';
import { Card, ArrowDivider, Button } from '../components/ui.tsx';
import { MoverFechaModal } from '../components/MoverFechaModal.tsx';
import { SinFechaPanel } from '../components/SinFechaPanel.tsx';
import { DESPLAZADAS_KEY, useDesplazadas } from '../lib/desplazadas.ts';
import { STATUS_LABEL } from '../lib/status.ts';
import type { AgendaApartado, AgendaEvent, AgendaResponse, Catalog, QuoteDetail } from '../lib/types.ts';
import { prioridadEspacio } from '@hsa/shared';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const pad = (n: number) => String(n).padStart(2, '0');
const hoyISO = new Date().toISOString().slice(0, 10);

// Orden operativo de espacios: Cúpula → Arcos → Campos → Balcones → Pajaritos.
const spacePriority = prioridadEspacio;
/** Espacio "principal" del evento = el de mayor prioridad operativa. */
function primarySpace(e: AgendaEvent, nombreById: Map<string, string>): { nombre: string; prio: number } {
  let best = { nombre: '', prio: Number.MAX_SAFE_INTEGER };
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
  { label: 'Pago a cuenta cubierto', dot: 'bg-white ring-1 ring-ink' },
  { label: 'Cortesía familiar', dot: 'bg-emerald-600' },
  { label: 'Fecha apartada (sin precio)', dot: 'bg-gold' },
];

/** El espacio "principal" de un apartado, con el mismo orden operativo. */
function primarySpaceApartado(a: AgendaApartado, nombreById: Map<string, string>): string {
  let best = { nombre: '', prio: Number.MAX_SAFE_INTEGER };
  for (const id of a.spaceIds) {
    const nombre = nombreById.get(id) ?? '';
    const prio = spacePriority(nombre);
    if (prio < best.prio) best = { nombre, prio };
  }
  return best.nombre;
}

/** Las tres vistas, como el calendario de Apple (Jorge, 15-oct-2026). */
type Vista = 'anio' | 'mes' | 'semana';
const VISTAS: { id: Vista; label: string }[] = [
  { id: 'anio', label: 'Año' },
  { id: 'mes', label: 'Mes' },
  { id: 'semana', label: 'Semana' },
];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** El lunes de la semana de `d` (la semana inicia en lunes). */
const lunesDe = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * La vista y el día que se está viendo viven en la URL (?v=semana&d=2026-10-15)
 * para que "atrás" del navegador regrese al mismo lugar en vez de reiniciar a
 * hoy. `?m=YYYY-MM` es la forma vieja (solo había mes) y se sigue entendiendo.
 */
function leerParams(params: URLSearchParams): { vista: Vista; ancla: Date } {
  const v = params.get('v');
  const vista: Vista = v === 'anio' || v === 'semana' ? v : 'mes';
  const d = params.get('d');
  const md = d ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) : null;
  if (md) return { vista, ancla: new Date(Number(md[1]), Number(md[2]) - 1, Number(md[3])) };
  const m = params.get('m');
  const mm = m ? /^(\d{4})-(\d{2})$/.exec(m) : null;
  if (mm) return { vista, ancla: new Date(Number(mm[1]), Number(mm[2]) - 1, 1) };
  const hoy = new Date();
  return { vista, ancla: new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) };
}

/** Del más importante al menos: el punto de un día en la vista de año es el del primero. */
function puntoDelDia(eventos: AgendaEvent[]): string | null {
  if (eventos.some((e) => e.esCortesia)) return 'bg-emerald-600';
  if (eventos.some((e) => e.status === 'complementada' || e.status === 'liquidada')) return 'bg-ink';
  if (eventos.some((e) => e.status === 'formalizada')) return 'bg-blue-600';
  if (eventos.length > 0) return 'bg-wine';
  return null;
}

export function AgendaPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { vista, ancla } = leerParams(params);
  const mes = { anio: ancla.getFullYear(), mes: ancla.getMonth() };
  const lunes = lunesDe(ancla);

  const primerDiaSemana = (new Date(mes.anio, mes.mes, 1).getDay() + 6) % 7; // 0=Lun (semana inicia lunes)
  const diasEnMes = new Date(mes.anio, mes.mes + 1, 0).getDate();
  const { from, to } =
    vista === 'anio'
      ? { from: `${mes.anio}-01-01`, to: `${mes.anio}-12-31` }
      : vista === 'semana'
        ? { from: iso(lunes), to: iso(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6)) }
        : { from: `${mes.anio}-${pad(mes.mes + 1)}-01`, to: `${mes.anio}-${pad(mes.mes + 1)}-${pad(diasEnMes)}` };

  const agendaQ = useQuery({
    queryKey: ['agenda', from, to],
    queryFn: () => api.get<AgendaResponse>(`/api/agenda?from=${from}&to=${to}`),
  });
  const catalogQ = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<Catalog>('/api/catalog'),
  });
  // Mismo caché que el aviso del panel: la agenda solo lo lee para marcar chips.
  const desplazadasQ = useDesplazadas();
  const qc = useQueryClient();
  const desplazadas = useMemo(
    () => new Set((desplazadasQ.data?.items ?? []).map((d) => d.id)),
    [desplazadasQ.data],
  );

  const nombreById = useMemo(
    () => new Map((catalogQ.data?.spaces ?? []).map((s) => [s.id, s.nombre])),
    [catalogQ.data],
  );

  /**
   * Los apartados por día, en su PROPIO mapa.
   *
   * No se mezclan con `events`: un apartado no tiene `quoteId`, ni cliente, ni
   * estatus, y el servidor los manda en una lista aparte justo para que la agenda
   * los pinte distinto. Meterlos en `porDia` obligaría a que el arrastre, el aviso
   * de empalmes y los colores por estatus trataran con eventos a medias.
   */
  const apartadosPorDia = useMemo(() => {
    const m = new Map<string, AgendaApartado[]>();
    (agendaQ.data?.apartados ?? []).forEach((a) => {
      const key = a.fechaEvento.slice(0, 10);
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    });
    return m;
  }, [agendaQ.data]);

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

  // Reemplaza la URL (replace) para no llenar el historial con cada clic de flecha.
  function ir(v: Vista, d: Date) {
    const next = new URLSearchParams(params);
    next.delete('m');
    next.set('v', v);
    next.set('d', iso(d));
    setParams(next, { replace: true });
  }
  function avanzar(delta: number) {
    const y = ancla.getFullYear();
    const m = ancla.getMonth();
    if (vista === 'anio') ir(vista, new Date(y + delta, m, 1));
    else if (vista === 'mes') ir(vista, new Date(y, m + delta, 1));
    else ir(vista, new Date(y, m, ancla.getDate() + 7 * delta));
  }
  function irHoy() {
    const hoy = new Date();
    ir(vista, new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
  }

  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
  const titulo =
    vista === 'anio'
      ? String(mes.anio)
      : vista === 'mes'
        ? capital(new Date(mes.anio, mes.mes, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }))
        : lunes.getMonth() === domingo.getMonth()
          ? `${lunes.getDate()} – ${domingo.getDate()} ${MESES_CORTOS[domingo.getMonth()]} ${domingo.getFullYear()}`
          : `${lunes.getDate()} ${MESES_CORTOS[lunes.getMonth()]} – ${domingo.getDate()} ${MESES_CORTOS[domingo.getMonth()]} ${domingo.getFullYear()}`;
  const unidad = vista === 'anio' ? 'Año' : vista === 'mes' ? 'Mes' : 'Semana';

  // Celdas: blancos iniciales + días del mes.
  const celdas: (number | null)[] = [
    ...Array.from({ length: primerDiaSemana }, () => null),
    ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
  ];

  // Al abrir una cotización, lleva el mes de origen para poder regresar aquí.
  function abrir(quoteId: string) {
    navigate(`/eventos/${quoteId}?volver=agenda&v=${vista}&d=${iso(ancla)}`);
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
  // Falla al preparar el arrastre: el modal todavía no existe, así que el aviso
  // va en la página. Si no, soltar el chip no haría absolutamente nada y el
  // usuario volvería a arrastrar sin saber qué se rompió.
  const [errorArrastre, setErrorArrastre] = useState('');

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
    setErrorArrastre('');

    let detalle: QuoteDetail;
    try {
      detalle = await api.get<QuoteDetail>(`/api/quotes/${quoteId}`);
    } catch {
      setErrorArrastre('No se pudo cargar el evento para moverlo. Intenta de nuevo.');
      return;
    }

    // La previa se calcula con el catálogo DE LA COTIZACIÓN, no con el activo:
    // mover la fecha no la represia (el servidor recalcula contra el catálogo
    // que fijó), así que usar el activo enseñaría un precio que nunca se guarda.
    let engine: Catalog['engine'] | null = null;
    try {
      const suyo = await qc.fetchQuery({
        queryKey: ['catalog', detalle.quote.priceListId],
        queryFn: () => api.get<Catalog>(`/api/catalog?priceListId=${detalle.quote.priceListId}`),
      });
      engine = suyo.engine;
    } catch {
      engine = null; // sin catálogo no hay previa, pero el arrastre sigue siendo posible
    }

    let totalNuevo: number | null = null;
    if (engine) {
      try {
        totalNuevo = Math.round(
          computeQuote(engine, {
            fecha: destino,
            invitados: detalle.quote.invitados,
            spaceIds: detalle.quote.spaceIds,
            horasExtra: detalle.quote.horasExtra,
            usaCapilla: detalle.quote.usaCapilla ?? false,
            usaDjHoraExtra: detalle.quote.usaDjHoraExtra ?? false,
            eventTypeId: detalle.quote.eventTypeId,
            foodPackageId: detalle.quote.foodPackageId ?? undefined,
            addOns: detalle.quote.addOns ?? [],
            // Los extras y el descuento de cortesía no dependen de la fecha, pero
            // sí del total: sin ellos la previa del arrastre enseñaría un número
            // distinto al que el servidor va a guardar.
            extras: detalle.quote.extras ?? [],
            descuentoPct: detalle.quote.descuentoPct ?? undefined,
            descuentoMonto: detalle.quote.descuentoMonto ?? undefined,
            descuentoMotivo: detalle.quote.descuentoMotivo ?? undefined,
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
      // Mover la fecha es una de las dos formas de resolver un empalme: el
      // símbolo del chip tiene que desaparecer sin recargar la página.
      await qc.invalidateQueries({ queryKey: DESPLAZADAS_KEY });
      setMover(null);
    } catch (e) {
      setErrorMover(e instanceof Error ? e.message : 'No se pudo mover el evento.');
    } finally {
      setMoviendo(false);
    }
  }

  /**
   * Los chips de un día: eventos (arrastrables) y fechas apartadas. Los mismos en
   * la vista de mes y en la de semana; en la de semana van más grandes y dicen
   * también el tipo de evento y el estatus.
   */
  function chipsDelDia(fecha: string, grande: boolean) {
    const eventos = porDia.get(fecha) ?? [];
    const tam = grande ? 'px-2.5 py-2 text-xs' : 'px-1.5 py-1 text-[0.7rem]';
    return (
      <>
        {eventos.map((e) => {
          // Un evento sin salón (solo capilla, una sesión de fotos) se
          // nombra por lo que es, no por un espacio vacío.
          const espacio =
            primarySpace(e, nombreById).nombre || (e.spaceIds.length === 0 && e.usaCapilla ? 'Capilla' : '');
          const empalmada = desplazadas.has(e.quoteId);
          const estatus = e.esCortesia ? 'Cortesía familiar' : STATUS_LABEL[e.status];
          return (
            <ChipArrastrable
              key={e.quoteId}
              id={e.quoteId}
              movible={e.status !== 'liquidada'}
              onClick={() => abrir(e.quoteId)}
              title={`${espacio || e.eventoNombre} · ${e.cliente} · ${e.eventoNombre} · ${estatus}${
                empalmada ? ' · El espacio ya fue apartado por otro evento' : ''
              }`}
              className={`block w-full rounded text-left leading-tight ${tam} ${agendaChipStyle(e)}`}
            >
              <span className="flex items-start gap-1">
                {/* Texto real, no `::before` de CSS: un lector de pantalla debe anunciarlo. */}
                {empalmada && (
                  <span role="img" aria-label="El espacio ya fue apartado por otro evento" className="shrink-0 leading-none">
                    ⚠
                  </span>
                )}
                <span className="block min-w-0 truncate font-semibold">{espacio || e.eventoNombre}</span>
              </span>
              <span className="block truncate opacity-80">{e.cliente}</span>
              {grande && (
                <span className="mt-1 block truncate text-[0.65rem] uppercase tracking-wide opacity-70">
                  {e.eventoNombre} · {estatus}
                </span>
              )}
            </ChipArrastrable>
          );
        })}
        {(apartadosPorDia.get(fecha) ?? []).map((a) => (
          <ChipApartado
            key={a.apartadoId}
            apartado={a}
            espacio={primarySpaceApartado(a, nombreById)}
            // El de banquetero vive en su cuenta; el de un cliente
            // directo tiene su propia ficha.
            onClick={() => navigate(a.banqueteroId ? `/banqueteros/${a.banqueteroId}` : `/apartados/${a.apartadoId}`)}
          />
        ))}
      </>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>Disponibilidad</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">{titulo}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Año · Mes · Semana, como el calendario de Apple. */}
          <div role="tablist" aria-label="Vista del calendario" className="flex rounded-lg border border-cream-300 bg-cream-100/70 p-0.5">
            {VISTAS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={vista === v.id}
                onClick={() => ir(v.id, ancla)}
                className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${
                  vista === v.id ? 'bg-ink text-cream shadow-sm' : 'text-ink hover:bg-ink/5'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => avanzar(-1)} aria-label={`${unidad} anterior`}>
              <ChevronLeft size={16} />
            </Button>
            <Button variant="ghost" onClick={irHoy}>Hoy</Button>
            <Button variant="outline" onClick={() => avanzar(1)} aria-label={`${unidad} siguiente`}>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </div>

      <SinFechaPanel />

      {errorArrastre && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-wine/30 bg-wine/5 px-4 py-3 text-sm text-wine"
        >
          {errorArrastre}
        </div>
      )}

      {vista === 'anio' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, m) => (
            <MiniMes
              key={m}
              anio={mes.anio}
              mes={m}
              punto={(fecha) => {
                const p = puntoDelDia(porDia.get(fecha) ?? []);
                return p ?? ((apartadosPorDia.get(fecha) ?? []).length > 0 ? 'bg-gold' : null);
              }}
              cuantos={(fecha) => (porDia.get(fecha) ?? []).length + (apartadosPorDia.get(fecha) ?? []).length}
              onMes={() => ir('mes', new Date(mes.anio, m, 1))}
              onDia={(d) => ir('semana', d)}
            />
          ))}
        </div>
      )}

      {vista !== 'anio' && (
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {vista === 'mes' && (
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
              const esHoy = fecha === hoyISO;
              return (
                <CeldaSoltable key={fecha} fecha={fecha}>
                  <button
                    type="button"
                    onClick={() => ir('semana', new Date(mes.anio, mes.mes, dia))}
                    aria-label={`Ver la semana del ${dia}`}
                    className={`mb-1 block w-full text-right text-xs hover:text-ink ${esHoy ? 'font-bold text-gold' : 'text-charcoal-soft'}`}
                  >
                    {esHoy ? <span className="rounded-full bg-gold px-1.5 py-0.5 text-cream">{dia}</span> : dia}
                  </button>
                  <div className="space-y-1">{chipsDelDia(fecha, false)}</div>
                </CeldaSoltable>
              );
            })}
          </div>
        </Card>
        )}

        {vista === 'semana' && (
          <Card className="overflow-hidden p-0">
            <div className="grid md:grid-cols-7">
              {Array.from({ length: 7 }, (_, i) => {
                const d = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i);
                const fecha = iso(d);
                const esHoy = fecha === hoyISO;
                return (
                  <CeldaSoltable key={fecha} fecha={fecha} alto="md:min-h-[24rem]">
                    <div className="mb-2 flex items-baseline gap-2 border-b border-cream-200 pb-1.5 md:block md:text-center">
                      <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-soft">{DIAS[i]}</span>
                      <span
                        className={`font-display text-2xl md:block ${
                          esHoy ? 'mx-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-gold text-cream' : 'text-ink'
                        }`}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                    <div className="space-y-1.5">{chipsDelDia(fecha, true)}</div>
                  </CeldaSoltable>
                );
              })}
            </div>
          </Card>
        )}
      </DndContext>
      )}

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
        El chip muestra el espacio (Cúpula → Arcos → Campos). Toca un evento para abrirlo, o
        arrástralo a otro día para cambiarle la fecha. El símbolo ⚠ marca las
        cotizaciones cuyo espacio ya fue apartado por otro evento ese mismo día.
      </p>
      <p className="mt-1 text-xs text-charcoal-soft">
        Los chips dorados con marcador son <strong>fechas apartadas</strong> por un banquetero o un
        cliente: bloquean la fecha pero todavía no tienen cotización. No se arrastran. Al tocarlos se
        abre la cuenta del banquetero (o la ficha del apartado, si es de un cliente), que es donde se
        cancelan o se convierten.
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled: !movible,
  });
  // `attributes` se aplica solo si el chip se puede arrastrar: cuando está
  // desactivado trae `aria-disabled="true"`, y el chip de un evento liquidado
  // NO está desactivado — sigue abriendo su contrato al tocarlo. Anunciarlo
  // como deshabilitado haría que el lector de pantalla lo diera por muerto.
  //
  // El chip sigue al dedo: sin `transform` solo se desvanecía en su sitio, que
  // en tablet se lee como "la app me ignoró". `relative` + `z-index` lo
  // mantienen por encima de las celdas vecinas mientras viaja.
  const style = transform
    ? { transform: CSS.Translate.toString(transform), position: 'relative' as const, zIndex: 20 }
    : undefined;

  return (
    <button
      ref={setNodeRef}
      {...(movible ? { ...listeners, ...attributes } : {})}
      onClick={onClick}
      title={title}
      style={style}
      // `touch-action: none` es requisito de @dnd-kit para arrastrar con el
      // dedo: sin esto el navegador se queda el gesto como scroll y el
      // arrastre nunca arranca en tablet, que es donde se opera.
      className={`${className} ${isDragging ? 'opacity-40' : ''} ${movible ? 'cursor-grab touch-none' : ''}`}
    >
      {children}
    </button>
  );
}

/**
 * Una fecha apartada por un banquetero.
 *
 * Se ve distinto a propósito: dorado punteado con marcador, con el nombre del
 * banquetero en vez de un cliente y SIN precio, porque no hay ninguno. No se
 * arrastra —la API no tiene forma de mover un apartado de fecha, y un arrastre
 * que no hace nada es peor que no poder arrastrar— y al tocarlo se abre la cuenta
 * del banquetero (o la ficha del apartado, si lo apartó un cliente directo), donde
 * se cancela o se convierte.
 */
function ChipApartado({
  apartado: a,
  espacio,
  onClick,
}: {
  apartado: AgendaApartado;
  espacio: string;
  onClick: () => void;
}) {
  const vence = new Date(a.venceISO).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Fecha apartada · ${espacio || 'espacio'} · ${a.banquetero} · vence ${vence}${
        a.abonado > 0 ? ` · abonado $${a.abonado.toLocaleString('es-MX')}` : ' · sin abonos'
      }${a.nota ? ` · ${a.nota}` : ''} · sin precio todavía`}
      className="block w-full rounded border border-dashed border-gold bg-gold/15 px-1.5 py-1 text-left text-[0.7rem] leading-tight text-gold transition-colors hover:bg-gold/25"
    >
      <span className="flex items-start gap-1">
        {/* Texto real para el lector de pantalla, no solo un color. */}
        <Bookmark size={11} className="mt-[0.15rem] shrink-0" aria-hidden />
        <span className="sr-only">Fecha apartada, sin precio: </span>
        <span className="block min-w-0 truncate font-semibold">{espacio || 'Apartado'}</span>
      </span>
      <span className="block truncate opacity-80">{a.banquetero}</span>
    </button>
  );
}

/** Una celda de día que acepta eventos soltados encima. */
function CeldaSoltable({ fecha, alto = '', children }: { fecha: string; alto?: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: fecha });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[6rem] border-b border-r border-cream-200 p-1.5 ${alto} ${isOver ? 'bg-gold/10 ring-1 ring-inset ring-gold' : ''}`}
    >
      {children}
    </div>
  );
}

/**
 * Un mes en miniatura para la vista de año. Cada día con algo lleva un punto del
 * color de su evento más avanzado (el mismo código de colores que los chips), y
 * el número en negritas. Tocar el nombre abre el mes; tocar un día, su semana.
 */
function MiniMes({
  anio,
  mes,
  punto,
  cuantos,
  onMes,
  onDia,
}: {
  anio: number;
  mes: number;
  punto: (fecha: string) => string | null;
  cuantos: (fecha: string) => number;
  onMes: () => void;
  onDia: (d: Date) => void;
}) {
  const blancos = (new Date(anio, mes, 1).getDay() + 6) % 7;
  const dias = new Date(anio, mes + 1, 0).getDate();
  const nombre = capital(new Date(anio, mes, 1).toLocaleDateString('es-MX', { month: 'long' }));
  const esMesActual = new Date().getFullYear() === anio && new Date().getMonth() === mes;
  const total = Array.from({ length: dias }, (_, i) => cuantos(`${anio}-${pad(mes + 1)}-${pad(i + 1)}`)).reduce((a, b) => a + b, 0);
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={onMes}
        className={`mb-2 flex w-full items-baseline justify-between rounded font-display text-xl hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${
          esMesActual ? 'text-gold' : 'text-ink'
        }`}
      >
        {nombre}
        <span className="font-sans text-xs text-charcoal-soft">
          {total > 0 ? `${total} ${total === 1 ? 'evento' : 'eventos'}` : ''}
        </span>
      </button>
      <div className="grid grid-cols-7 text-center text-[0.6rem] font-semibold uppercase text-charcoal-soft">
        {DIAS.map((d) => (
          <span key={d}>{d.charAt(0)}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-0.5 text-center text-xs">
        {Array.from({ length: blancos }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: dias }, (_, i) => {
          const dia = i + 1;
          const fecha = `${anio}-${pad(mes + 1)}-${pad(dia)}`;
          const color = punto(fecha);
          const esHoy = fecha === hoyISO;
          const n = cuantos(fecha);
          return (
            <button
              key={fecha}
              type="button"
              onClick={() => onDia(new Date(anio, mes, dia))}
              aria-label={`${dia} de ${nombre}${n ? `: ${n} ${n === 1 ? 'evento' : 'eventos'}` : ''}`}
              className="flex flex-col items-center rounded py-0.5 hover:bg-cream-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full tabular-nums ${
                  esHoy ? 'bg-gold font-bold text-cream' : color ? 'font-semibold text-ink' : 'text-charcoal-soft'
                }`}
              >
                {dia}
              </span>
              <span className={`mt-0.5 h-1 w-1 rounded-full ${color ?? 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>
    </Card>
  );
}
