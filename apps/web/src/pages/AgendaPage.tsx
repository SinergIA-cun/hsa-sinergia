import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Search } from 'lucide-react';
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
import { coincideTexto, computeQuote } from '@hsa/shared';
import { useAuth } from '../auth/auth.tsx';
import { api } from '../lib/api.ts';
import { CabeceraCalendario, VistaAnio, VistaMes, VistaSemana, iso, useCalendario } from '../components/calendario/Calendario.tsx';
import { MoverFechaModal } from '../components/MoverFechaModal.tsx';
import { SinFechaPanel } from '../components/SinFechaPanel.tsx';
import { DESPLAZADAS_KEY, useDesplazadas } from '../lib/desplazadas.ts';
import { STATUS_LABEL } from '../lib/status.ts';
import type { AgendaApartado, AgendaEvent, AgendaResponse, Catalog, Quote, QuoteDetail } from '../lib/types.ts';
import { formatEventDate } from '../lib/date.ts';
import { prioridadEspacio } from '@hsa/shared';

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
  const cal = useCalendario();
  // Arrastrar es mover: después de formalizar, solo un admin (15-oct-2026).
  const isAdmin = useAuth().user?.role === 'admin';
  const { vista, ancla, from, to } = cal;

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

  // Al abrir una cotización, lleva la vista y el día para poder regresar aquí.
  function abrir(quoteId: string) {
    navigate(`/eventos/${quoteId}?volver=agenda&v=${vista}&d=${iso(ancla)}`);
  }
  // Tocar un día vacío en Mes o Semana: un evento nuevo en ese día (Jorge, 15-oct-2026).
  function nuevoEvento(fecha: string) {
    navigate(`/eventos/nuevo?fecha=${fecha}`);
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
          // De otro vendedor: solo "ocupado" y el salón. No se abre ni se arrastra.
          if (e.ajeno) {
            return (
              <button
                key={e.quoteId}
                type="button"
                title={`${espacio || 'Salón'} ocupado por otro evento`}
                aria-label={`${espacio || 'Salón'} ocupado`}
                className={`block w-full cursor-default rounded bg-ink/10 text-left leading-tight text-charcoal-soft ${tam}`}
              >
                <span className="block truncate font-semibold">{espacio || 'Salón'}</span>
                <span className="block truncate opacity-80">Ocupado</span>
              </button>
            );
          }
          return (
            <ChipArrastrable
              key={e.quoteId}
              id={e.quoteId}
              movible={!e.cerrado && (isAdmin ? e.status !== 'liquidada' : e.status === 'borrador')}
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

  /** En Mes y Semana cada día acepta eventos soltados encima. */
  const soltable = (alto: string) => (fecha: string, hijos: ReactNode, onClick: (e: MouseEvent<HTMLElement>) => void) => (
    <CeldaSoltable fecha={fecha} alto={alto} onClick={onClick}>
      {hijos}
    </CeldaSoltable>
  );

  return (
    <div>
      <CabeceraCalendario cal={cal} seccion="Agenda de eventos" extra={<BuscadorEventos onAbrir={abrir} onVer={(f) => cal.ir('mes', new Date(`${f}T12:00:00`))} />} />

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
        <VistaAnio
          cal={cal}
          punto={(fecha) => {
            const p = puntoDelDia(porDia.get(fecha) ?? []);
            return p ?? ((apartadosPorDia.get(fecha) ?? []).length > 0 ? 'bg-gold' : null);
          }}
          cuantos={(fecha) => (porDia.get(fecha) ?? []).length + (apartadosPorDia.get(fecha) ?? []).length}
        />
      )}

      {vista !== 'anio' && (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {vista === 'mes' && (
            <VistaMes cal={cal} contenido={(f) => chipsDelDia(f, false)} onDia={nuevoEvento} etiquetaNuevo="Nuevo evento" envolver={soltable('')} />
          )}
          {vista === 'semana' && (
            <VistaSemana cal={cal} contenido={(f) => chipsDelDia(f, true)} onDia={nuevoEvento} etiquetaNuevo="Nuevo evento" envolver={soltable('min-h-[5rem] md:min-h-[24rem]')} />
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
        arrástralo a otro día para cambiarle la fecha. Toca un día vacío para crear un evento nuevo ese día. El símbolo ⚠ marca las
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
function CeldaSoltable({ fecha, alto, onClick, children }: {
  fecha: string; alto: string; onClick: (e: MouseEvent<HTMLElement>) => void; children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: fecha });
  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={`cursor-pointer border-b border-r border-cream-200 p-1.5 transition-colors hover:bg-cream-100/60 ${alto || 'min-h-[6rem]'} ${isOver ? 'bg-gold/10 ring-1 ring-inset ring-gold' : ''}`}
    >
      {children}
    </div>
  );
}

/**
 * Buscar un evento desde la agenda (Jorge, 15-oct-2026): por cliente, código,
 * tipo de evento, teléfono o fecha. Tocar el resultado abre el evento; "Ver en
 * agenda" lleva el calendario a su mes.
 */
function BuscadorEventos({ onAbrir, onVer }: { onAbrir: (id: string) => void; onVer: (fecha: string) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim();
  const { data } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => api.get<{ quotes: Quote[] }>('/api/quotes'),
    enabled: needle.length > 0,
  });
  const resultados = useMemo(() => {
    if (needle.length < 2) return [];
    return (data?.quotes ?? [])
      .filter((x) =>
        coincideTexto(
          [x.client?.nombre, x.client?.telefono, x.etiqueta, x.folio, x.eventType?.nombre, x.festejado, x.fechaEvento.slice(0, 10), formatEventDate(x.fechaEvento)],
          needle,
        ),
      )
      .sort((a, b) => a.fechaEvento.localeCompare(b.fechaEvento))
      .slice(0, 8);
  }, [data, needle]);

  return (
    <div className="relative max-w-xl">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQ('')}
        placeholder="Buscar evento: cliente, código, teléfono, tipo o fecha…"
        aria-label="Buscar evento"
        className="w-full rounded-lg border border-ink/15 bg-white/80 py-2.5 pl-9 pr-3 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
      />
      {needle.length >= 2 && (
        <ul className="absolute z-30 mt-1 w-full divide-y divide-cream-200 overflow-hidden rounded-lg border border-cream-300 bg-white shadow-lg">
          {resultados.length === 0 && <li className="px-3 py-2.5 text-sm text-charcoal-soft">{data ? 'Sin coincidencias.' : 'Buscando…'}</li>}
          {resultados.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-cream-100">
              <button type="button" onClick={() => onAbrir(x.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium text-ink">{x.client?.nombre ?? 'Cliente'}</span>
                <span className="block truncate text-xs text-charcoal-soft">
                  {formatEventDate(x.fechaEvento)} · {x.eventType?.nombre ?? 'Evento'} · {STATUS_LABEL[x.status]}
                  {x.etiqueta ? ` · ${x.etiqueta}` : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onVer(x.fechaEvento.slice(0, 10));
                  setQ('');
                }}
                className="shrink-0 text-xs font-medium text-gold hover:underline"
              >
                Ver en agenda
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
