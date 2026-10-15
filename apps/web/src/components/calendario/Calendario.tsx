import type { MouseEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { ArrowDivider, Button, Card } from '../ui.tsx';

/**
 * Lo que comparten la Agenda de Eventos y la de Apartados: las tres vistas (Año,
 * Mes, Semana, como el calendario de Apple), la navegación y la URL.
 *
 * Reglas de Jorge (15-oct-2026):
 *  - En Año, tocar un día abre su MES (no la semana).
 *  - En Mes o Semana, tocar un día vacío crea algo nuevo en ese día (un evento
 *    o un apartado, según la agenda). Tocar algo que ya existe lo abre.
 */

export type Vista = 'anio' | 'mes' | 'semana';
export const VISTAS: { id: Vista; label: string }[] = [
  { id: 'anio', label: 'Año' },
  { id: 'mes', label: 'Mes' },
  { id: 'semana', label: 'Semana' },
];
export const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hoyISO = iso(new Date());
/** El lunes de la semana de `d` (la semana inicia en lunes). */
const lunesDe = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const diaDe = (fecha: string) => {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

/**
 * La vista y el día que se está viendo viven en la URL (?v=semana&d=2026-10-15)
 * para que "atrás" del navegador regrese al mismo lugar en vez de reiniciar a
 * hoy. `?m=YYYY-MM` es la forma vieja (solo había mes) y se sigue entendiendo.
 */
function leerParams(params: URLSearchParams): { vista: Vista; ancla: Date } {
  const v = params.get('v');
  const vista: Vista = v === 'anio' || v === 'semana' ? v : 'mes';
  const d = params.get('d');
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return { vista, ancla: diaDe(d) };
  const m = params.get('m');
  const mm = m ? /^(\d{4})-(\d{2})$/.exec(m) : null;
  if (mm) return { vista, ancla: new Date(Number(mm[1]), Number(mm[2]) - 1, 1) };
  const hoy = new Date();
  return { vista, ancla: new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) };
}

export function useCalendario() {
  const [params, setParams] = useSearchParams();
  const { vista, ancla } = leerParams(params);
  const anio = ancla.getFullYear();
  const mes = ancla.getMonth();
  const lunes = lunesDe(ancla);
  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
  const diasEnMes = new Date(anio, mes + 1, 0).getDate();

  const { from, to } =
    vista === 'anio'
      ? { from: `${anio}-01-01`, to: `${anio}-12-31` }
      : vista === 'semana'
        ? { from: iso(lunes), to: iso(domingo) }
        : { from: `${anio}-${pad(mes + 1)}-01`, to: `${anio}-${pad(mes + 1)}-${pad(diasEnMes)}` };

  // Reemplaza la URL (replace) para no llenar el historial con cada clic de flecha.
  function ir(v: Vista, d: Date) {
    const next = new URLSearchParams(params);
    next.delete('m');
    next.set('v', v);
    next.set('d', iso(d));
    setParams(next, { replace: true });
  }
  function avanzar(delta: number) {
    if (vista === 'anio') ir(vista, new Date(anio + delta, mes, 1));
    else if (vista === 'mes') ir(vista, new Date(anio, mes + delta, 1));
    else ir(vista, new Date(anio, mes, ancla.getDate() + 7 * delta));
  }
  function irHoy() {
    const hoy = new Date();
    ir(vista, new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
  }

  const titulo =
    vista === 'anio'
      ? String(anio)
      : vista === 'mes'
        ? capital(new Date(anio, mes, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }))
        : lunes.getMonth() === domingo.getMonth()
          ? `${lunes.getDate()} – ${domingo.getDate()} ${MESES_CORTOS[domingo.getMonth()]} ${domingo.getFullYear()}`
          : `${lunes.getDate()} ${MESES_CORTOS[lunes.getMonth()]} – ${domingo.getDate()} ${MESES_CORTOS[domingo.getMonth()]} ${domingo.getFullYear()}`;

  return { vista, ancla, anio, mes, lunes, from, to, ir, avanzar, irHoy, titulo, diasEnMes };
}

export type Cal = ReturnType<typeof useCalendario>;

/** Título, Año · Mes · Semana, flechas y "Hoy". `extra` va debajo (p. ej. el buscador). */
export function CabeceraCalendario({ cal, seccion, extra }: { cal: Cal; seccion: string; extra?: ReactNode }) {
  const unidad = cal.vista === 'anio' ? 'Año' : cal.vista === 'mes' ? 'Mes' : 'Semana';
  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>{seccion}</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">{cal.titulo}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Vista del calendario" className="flex rounded-lg border border-cream-300 bg-cream-100/70 p-0.5">
            {VISTAS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={cal.vista === v.id}
                onClick={() => cal.ir(v.id, cal.ancla)}
                className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${
                  cal.vista === v.id ? 'bg-ink text-cream shadow-sm' : 'text-ink hover:bg-ink/5'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => cal.avanzar(-1)} aria-label={`${unidad} anterior`}>
              <ChevronLeft size={16} />
            </Button>
            <Button variant="ghost" onClick={cal.irHoy}>Hoy</Button>
            <Button variant="outline" onClick={() => cal.avanzar(1)} aria-label={`${unidad} siguiente`}>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </div>
      {extra}
    </div>
  );
}

/** Los 12 meses en miniatura. Tocar un día (o el nombre del mes) abre ese mes. */
export function VistaAnio({
  cal,
  punto,
  cuantos,
  palabra = ['evento', 'eventos'],
}: {
  cal: Cal;
  punto: (fecha: string) => string | null;
  cuantos: (fecha: string) => number;
  palabra?: [string, string];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => (
        <MiniMes
          key={m}
          anio={cal.anio}
          mes={m}
          punto={punto}
          cuantos={cuantos}
          palabra={palabra}
          onDia={(d) => cal.ir('mes', d)}
        />
      ))}
    </div>
  );
}

/**
 * Tocar el fondo de un día crea algo nuevo ahí; tocar un chip (botón o enlace)
 * lo abre a él. El chip no tiene que acordarse de detener el clic: aquí se mira
 * si el clic salió de un botón o un enlace.
 */
function alTocarDia(fecha: string, onDia: (fecha: string) => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    onDia(fecha);
  };
}

/** El botón del número del día: crea algo nuevo en ese día (también con teclado). */
function NumeroDia({ fecha, dia, grande, etiquetaNuevo, onDia }: {
  fecha: string; dia: number; grande?: boolean; etiquetaNuevo: string; onDia: (fecha: string) => void;
}) {
  const esHoy = fecha === hoyISO;
  return (
    <button
      type="button"
      onClick={() => onDia(fecha)}
      aria-label={`${etiquetaNuevo} el ${dia}`}
      title={etiquetaNuevo}
      className={`group/dia inline-flex items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${
        grande ? 'font-display text-2xl' : 'text-xs'
      } ${esHoy ? 'font-bold text-gold' : 'text-charcoal-soft hover:text-ink'}`}
    >
      <Plus size={grande ? 14 : 11} className="opacity-0 transition-opacity group-hover/dia:opacity-100" aria-hidden />
      {esHoy ? (
        <span className={`inline-flex items-center justify-center rounded-full bg-gold text-cream ${grande ? 'h-9 w-9' : 'px-1.5 py-0.5'}`}>{dia}</span>
      ) : (
        <span className={grande ? 'text-ink' : ''}>{dia}</span>
      )}
    </button>
  );
}

/**
 * La cuadrícula del mes. `envolver` deja que la agenda de eventos haga cada
 * celda "soltable" para el arrastre; sin él es un `div` normal.
 */
export function VistaMes({
  cal,
  contenido,
  onDia,
  etiquetaNuevo,
  envolver,
}: {
  cal: Cal;
  contenido: (fecha: string) => ReactNode;
  onDia: (fecha: string) => void;
  etiquetaNuevo: string;
  envolver?: (fecha: string, hijos: ReactNode, onClick: (e: MouseEvent<HTMLElement>) => void) => ReactNode;
}) {
  const blancos = (new Date(cal.anio, cal.mes, 1).getDay() + 6) % 7;
  const celdas: (number | null)[] = [
    ...Array.from({ length: blancos }, () => null),
    ...Array.from({ length: cal.diasEnMes }, (_, i) => i + 1),
  ];
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-cream-300 bg-cream-100 text-center text-xs font-semibold uppercase tracking-wide text-charcoal-soft">
        {DIAS.map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {celdas.map((dia, i) => {
          if (dia === null) return <div key={`b${i}`} className="min-h-[6rem] border-b border-r border-cream-200 bg-cream-50/40" />;
          const fecha = `${cal.anio}-${pad(cal.mes + 1)}-${pad(dia)}`;
          const hijos = (
            <>
              <div className="mb-1 text-right">
                <NumeroDia fecha={fecha} dia={dia} etiquetaNuevo={etiquetaNuevo} onDia={onDia} />
              </div>
              <div className="space-y-1">{contenido(fecha)}</div>
            </>
          );
          const onClick = alTocarDia(fecha, onDia);
          return envolver ? (
            <div key={fecha} className="contents">{envolver(fecha, hijos, onClick)}</div>
          ) : (
            <div key={fecha} onClick={onClick} className="min-h-[6rem] cursor-pointer border-b border-r border-cream-200 p-1.5 transition-colors hover:bg-cream-100/60">
              {hijos}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Siete columnas con tarjetas grandes. En celular, un día debajo del otro. */
export function VistaSemana({
  cal,
  contenido,
  onDia,
  etiquetaNuevo,
  envolver,
}: {
  cal: Cal;
  contenido: (fecha: string) => ReactNode;
  onDia: (fecha: string) => void;
  etiquetaNuevo: string;
  envolver?: (fecha: string, hijos: ReactNode, onClick: (e: MouseEvent<HTMLElement>) => void) => ReactNode;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid md:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(cal.lunes.getFullYear(), cal.lunes.getMonth(), cal.lunes.getDate() + i);
          const fecha = iso(d);
          const hijos = (
            <>
              <div className="mb-2 flex items-center gap-2 border-b border-cream-200 pb-1.5 md:flex-col md:gap-0">
                <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-soft">{DIAS[i]}</span>
                <NumeroDia fecha={fecha} dia={d.getDate()} grande etiquetaNuevo={etiquetaNuevo} onDia={onDia} />
              </div>
              <div className="space-y-1.5">{contenido(fecha)}</div>
            </>
          );
          const onClick = alTocarDia(fecha, onDia);
          return envolver ? (
            <div key={fecha} className="contents">{envolver(fecha, hijos, onClick)}</div>
          ) : (
            <div
              key={fecha}
              onClick={onClick}
              className="min-h-[5rem] cursor-pointer border-b border-r border-cream-200 p-1.5 transition-colors hover:bg-cream-100/60 md:min-h-[24rem]"
            >
              {hijos}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * Un mes en miniatura para la vista de año. Cada día con algo lleva un punto del
 * color que diga la agenda, y el número en negritas. Tocar el nombre o un día
 * abre ese mes.
 */
function MiniMes({
  anio,
  mes,
  punto,
  cuantos,
  palabra,
  onDia,
}: {
  anio: number;
  mes: number;
  punto: (fecha: string) => string | null;
  cuantos: (fecha: string) => number;
  palabra: [string, string];
  onDia: (d: Date) => void;
}) {
  const blancos = (new Date(anio, mes, 1).getDay() + 6) % 7;
  const dias = new Date(anio, mes + 1, 0).getDate();
  const nombre = capital(new Date(anio, mes, 1).toLocaleDateString('es-MX', { month: 'long' }));
  const esMesActual = new Date().getFullYear() === anio && new Date().getMonth() === mes;
  const total = Array.from({ length: dias }, (_, i) => cuantos(`${anio}-${pad(mes + 1)}-${pad(i + 1)}`)).reduce((a, b) => a + b, 0);
  const contar = (n: number) => `${n} ${n === 1 ? palabra[0] : palabra[1]}`;
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => onDia(new Date(anio, mes, 1))}
        className={`mb-2 flex w-full items-baseline justify-between rounded font-display text-xl hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${
          esMesActual ? 'text-gold' : 'text-ink'
        }`}
      >
        {nombre}
        <span className="font-sans text-xs text-charcoal-soft">{total > 0 ? contar(total) : ''}</span>
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
              aria-label={`${dia} de ${nombre}${n ? `: ${contar(n)}` : ''}`}
              className="flex flex-col items-center rounded py-0.5 hover:bg-cream-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full tabular-nums ${
                  esHoy ? 'bg-gold font-bold text-cream' : color ? 'font-semibold text-ink' : 'text-charcoal-soft'
                }`}
              >
                {dia}
              </span>
              <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${color ?? 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>
    </Card>
  );
}
