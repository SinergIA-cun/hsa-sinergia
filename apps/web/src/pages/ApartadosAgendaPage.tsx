import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../auth/auth.tsx';
import { CabeceraCalendario, VistaAnio, VistaMes, VistaSemana, useCalendario } from '../components/calendario/Calendario.tsx';
import { ApartadoDetalleModal, Contador, NuevoApartadoModal } from '../components/apartados/ApartadoModales.tsx';
import { AvisosApartados } from '../components/apartados/AvisosApartados.tsx';
import { SelectInput } from '../components/ui.tsx';
import type { AgendaResponse, ApartadoRapido, Catalog } from '../lib/types.ts';

/**
 * La agenda de Apartados (Jorge, 15-oct-2026). Igual que la de eventos —Año,
 * Mes, Semana—, pero lo que se captura aquí son apartados rápidos: nombre,
 * teléfono y tipo de evento, con 15 días de vida y fila de espera por día.
 *
 * También enseña, en dorado punteado y solo para abrir, las fechas apartadas
 * por banqueteros o clientes con abono (los apartados de siempre).
 */
export function ApartadosAgendaPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const cal = useCalendario();
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<ApartadoRapido | null>(null);
  const [info, setInfo] = useState('');

  const q = useQuery({
    queryKey: ['apartados-rapidos', cal.from, cal.to],
    queryFn: () => api.get<{ apartados: ApartadoRapido[]; tope: number }>(`/api/apartados-rapidos?from=${cal.from}&to=${cal.to}`),
  });
  const conAbono = useQuery({
    queryKey: ['agenda', cal.from, cal.to],
    queryFn: () => api.get<AgendaResponse>(`/api/agenda?from=${cal.from}&to=${cal.to}`),
  });
  const catalogQ = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Catalog>('/api/catalog') });
  const tope = q.data?.tope ?? 10;

  const porDia = useMemo(() => {
    const m = new Map<string, ApartadoRapido[]>();
    for (const a of q.data?.apartados ?? []) m.set(a.fecha, [...(m.get(a.fecha) ?? []), a]);
    return m;
  }, [q.data]);
  const conAbonoPorDia = useMemo(() => {
    const m = new Map<string, NonNullable<AgendaResponse['apartados']>>();
    for (const a of conAbono.data?.apartados ?? []) {
      const k = a.fechaEvento.slice(0, 10);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [conAbono.data]);

  async function refrescar(mensaje?: string) {
    await qc.invalidateQueries({ queryKey: ['apartados-rapidos'] });
    if (mensaje) setInfo(mensaje);
  }

  function contenido(fecha: string, grande: boolean) {
    const fila = porDia.get(fecha) ?? [];
    const tam = grande ? 'px-2.5 py-2 text-xs' : 'px-1.5 py-1 text-[0.7rem]';
    return (
      <>
        {fila.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAbierto(a)}
            title={`${a.posicion}. ${a.nombre} · ${a.eventType.nombre} · quedan ${a.diasRestantes} días`}
            className={`block w-full rounded text-left leading-tight transition-colors ${tam} ${
              a.porVencer
                ? 'bg-wine/15 text-wine ring-1 ring-wine/40 hover:bg-wine/25'
                : a.posicion === 1
                  ? 'bg-ink text-cream hover:bg-ink/90'
                  : 'bg-white text-ink ring-1 ring-ink/15 hover:bg-cream-100'
            }`}
          >
            <span className="flex items-center justify-between gap-1">
              <span className="min-w-0 truncate font-semibold">
                {a.posicion}. {a.nombre}
              </span>
              <Contador dias={a.diasRestantes} />
            </span>
            {grande && <span className="mt-0.5 block truncate opacity-80">{a.eventType.nombre}{a.telefono ? ` · ${a.telefono}` : ''}</span>}
          </button>
        ))}
        {fila.length >= tope && <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-wine">Fila llena</p>}
        {(conAbonoPorDia.get(fecha) ?? []).map((a) => (
          <button
            key={a.apartadoId}
            type="button"
            onClick={() => navigate(a.banqueteroId ? `/banqueteros/${a.banqueteroId}` : `/apartados/${a.apartadoId}`)}
            title={`Fecha apartada con abono · ${a.banquetero}`}
            className={`flex w-full items-center gap-1 rounded border border-dashed border-gold bg-gold/15 text-left leading-tight text-gold hover:bg-gold/25 ${tam}`}
          >
            <Bookmark size={11} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate font-semibold">{a.banquetero}</span>
          </button>
        ))}
      </>
    );
  }

  const buscador = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {isAdmin && (
        <label className="inline-flex items-center gap-2 text-sm text-charcoal-soft">
          Tope por día
          <SelectInput
            value={tope}
            onChange={async (e) => {
              await api.put('/api/apartados-rapidos/tope', { tope: Number(e.target.value) });
              await refrescar(`Tope de la fila: ${e.target.value} por día.`);
            }}
            className="w-auto py-1.5"
          >
            {[5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </SelectInput>
        </label>
      )}
      <p className="text-sm text-charcoal-soft">
        Toca un día para apartar. Cada apartado dura 15 días; los números son su lugar en la fila.
      </p>
    </div>
  );

  return (
    <div>
      <CabeceraCalendario cal={cal} seccion="Apartados" extra={buscador} />
      <AvisosApartados onAbrir={setAbierto} />
      {info && <p className="mb-4 rounded-lg bg-gold/15 px-4 py-2 text-sm text-gold">{info}</p>}

      {cal.vista === 'anio' && (
        <VistaAnio
          cal={cal}
          palabra={['apartado', 'apartados']}
          punto={(f) => {
            const fila = porDia.get(f) ?? [];
            if (fila.some((a) => a.porVencer)) return 'bg-wine';
            if (fila.length > 0) return 'bg-ink';
            return (conAbonoPorDia.get(f) ?? []).length > 0 ? 'bg-gold' : null;
          }}
          cuantos={(f) => (porDia.get(f) ?? []).length}
        />
      )}
      {cal.vista === 'mes' && <VistaMes cal={cal} contenido={(f) => contenido(f, false)} onDia={setNuevo} etiquetaNuevo="Nuevo apartado" />}
      {cal.vista === 'semana' && <VistaSemana cal={cal} contenido={(f) => contenido(f, true)} onDia={setNuevo} etiquetaNuevo="Nuevo apartado" />}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-charcoal-soft">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink" /> Primero en la fila</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-white ring-1 ring-ink/30" /> En espera</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-wine" /> Vence en 3 días o menos</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gold" /> Fecha apartada con abono (banquetero o cliente)</span>
      </div>

      {nuevo && (
        <NuevoApartadoModal
          fecha={nuevo}
          enFila={(porDia.get(nuevo) ?? []).length}
          tope={tope}
          tipos={catalogQ.data?.eventTypes ?? []}
          onCerrar={() => setNuevo(null)}
          onCambiarFecha={setNuevo}
          onListo={async () => {
            setNuevo(null);
            await refrescar('Apartado guardado. Corre su contador de 15 días.');
          }}
        />
      )}
      {abierto && (
        <ApartadoDetalleModal
          apartado={abierto}
          onCerrar={() => setAbierto(null)}
          onCambio={async (m) => {
            setAbierto(null);
            await refrescar(m);
            await qc.invalidateQueries({ queryKey: ['apartados-por-vencer'] });
          }}
        />
      )}
    </div>
  );
}
