import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Card, ArrowDivider, Button } from '../components/ui.tsx';
import { STATUS_STYLE } from '../lib/status.ts';
import type { AgendaEvent } from '../lib/types.ts';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const pad = (n: number) => String(n).padStart(2, '0');
const hoyISO = new Date().toISOString().slice(0, 10);

export function AgendaPage() {
  const navigate = useNavigate();
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return { anio: d.getFullYear(), mes: d.getMonth() }; // mes 0-11
  });

  const primerDiaSemana = new Date(mes.anio, mes.mes, 1).getDay(); // 0=Dom
  const diasEnMes = new Date(mes.anio, mes.mes + 1, 0).getDate();
  const from = `${mes.anio}-${pad(mes.mes + 1)}-01`;
  const to = `${mes.anio}-${pad(mes.mes + 1)}-${pad(diasEnMes)}`;

  const agendaQ = useQuery({
    queryKey: ['agenda', from, to],
    queryFn: () => api.get<{ events: AgendaEvent[] }>(`/api/agenda?from=${from}&to=${to}`),
  });

  const porDia = useMemo(() => {
    const m = new Map<string, AgendaEvent[]>();
    (agendaQ.data?.events ?? []).forEach((e) => {
      const key = e.fechaEvento.slice(0, 10);
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    });
    return m;
  }, [agendaQ.data]);

  function cambiarMes(delta: number) {
    setMes((prev) => {
      const d = new Date(prev.anio, prev.mes + delta, 1);
      return { anio: d.getFullYear(), mes: d.getMonth() };
    });
  }
  function irHoy() {
    const d = new Date();
    setMes({ anio: d.getFullYear(), mes: d.getMonth() });
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
                  {eventos.map((e) => (
                    <button
                      key={e.quoteId}
                      onClick={() => navigate(`/cotizaciones/${e.quoteId}`)}
                      title={`${e.cliente} · ${e.eventoNombre}`}
                      className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[0.7rem] font-medium ${STATUS_STYLE[e.status]}`}
                    >
                      {e.cliente}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {agendaQ.isLoading && <p className="mt-4 text-sm text-charcoal-soft">Cargando…</p>}
      <p className="mt-4 text-xs text-charcoal-soft">
        Toca un evento para abrir su cotización. El color indica el estatus.
      </p>
    </div>
  );
}
