import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Archive, CalendarDays, RefreshCw, Search, Users } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { useAuth } from '../auth/auth.tsx';
import { ArrowDivider, Button, Card, SelectInput } from '../components/ui.tsx';
import { FotoEventoVista } from '../components/historico/FotoEventoVista.tsx';
import type { PaginaHistorico, RenglonHistorico } from '../lib/types.ts';

/**
 * El archivo de eventos.
 *
 * Un evento que pasó deja de ser una previsión y se vuelve un hecho. Aquí queda
 * su foto: quién, dónde, con qué menú, cuánta gente, cuánto costó y cuánto se
 * pagó — copiado por nombre, para que se lea sola dentro de diez años.
 */
export function HistoricoPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [q, setQ] = useState('');
  const [anio, setAnio] = useState('');
  const [soloConSaldo, setSoloConSaldo] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [barriendo, setBarriendo] = useState(false);

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (anio) params.set('anio', anio);
  if (soloConSaldo) params.set('soloConSaldo', 'true');
  if (pagina > 0) params.set('pagina', String(pagina));

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['historico', q.trim(), anio, soloConSaldo, pagina],
    queryFn: () => api.get<PaginaHistorico>(`/api/historico?${params.toString()}`),
  });

  function reiniciar(cambio: () => void) {
    cambio();
    setPagina(0);
    setAbierto(null);
  }

  async function barrer() {
    setBarriendo(true);
    try {
      await api.post('/api/admin/historico/barrer', {});
      await refetch();
    } finally {
      setBarriendo(false);
    }
  }

  const filas = data?.filas ?? [];
  // Solo cuenta lo que SÍ se realizó: un borrador que nunca cerró tiene el total
  // como saldo, pero ahí no hay nada que cobrar.
  const conSaldo = filas.filter((f) => f.saldo > 0 && f.seRealizo).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>Archivo</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">Histórico de eventos</h1>
          <p className="mt-1 max-w-2xl text-sm text-charcoal-soft">
            Lo que ya pasó, con la foto de ese día. Los nombres, el desglose, los pagos y la hoja
            operativa quedan copiados: la foto se lee sola aunque el catálogo haya cambiado.
          </p>
        </div>
        {isAdmin && (
          // Aquí no hay planificador: el barrido corre al arrancar el contenedor.
          // Esperar a un reinicio para archivar el fin de semana que acaba de
          // pasar no es razonable, así que se puede forzar.
          <Button variant="outline" onClick={barrer} disabled={barriendo}>
            <RefreshCw size={15} className={barriendo ? 'animate-spin' : undefined} />
            {barriendo ? 'Archivando…' : 'Archivar lo pendiente'}
          </Button>
        )}
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
          />
          <input
            value={q}
            onChange={(e) => reiniciar(() => setQ(e.target.value))}
            placeholder="Buscar cliente, código, banquetero, festejado o espacio…"
            className="w-full rounded-lg border border-ink/15 bg-white/70 py-2.5 pl-9 pr-3 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-charcoal-soft">Año</span>
          <SelectInput value={anio} onChange={(e) => reiniciar(() => setAnio(e.target.value))}>
            <option value="">Todos</option>
            {(data?.anios ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="inline-flex items-center gap-2 py-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={soloConSaldo}
            onChange={(e) => reiniciar(() => setSoloConSaldo(e.target.checked))}
            className="h-4 w-4 accent-wine"
          />
          Solo eventos que quedaron debiendo
        </label>
      </div>

      {/* La pregunta incómoda del archivo. Por la regla del negocio —el evento no
          se hace si no está pagado— un evento pasado con saldo es un error de
          captura o un cobro perdido, nunca una situación normal. */}
      {!soloConSaldo && conSaldo > 0 && (
        <button
          type="button"
          onClick={() => reiniciar(() => setSoloConSaldo(true))}
          className="mb-5 flex w-full items-center gap-3 rounded-lg border-l-4 border-wine bg-wine/10 px-4 py-3 text-left text-sm text-ink transition-colors hover:bg-wine/15"
        >
          <AlertTriangle size={17} className="shrink-0 text-wine" />
          <span>
            <strong>{conSaldo}</strong> evento{conSaldo === 1 ? '' : 's'} de esta página{' '}
            {conSaldo === 1 ? 'quedó' : 'quedaron'} con saldo. Toca para ver todos los que deben.
          </span>
        </button>
      )}

      {isLoading && <p className="text-charcoal-soft">Cargando…</p>}

      {!isLoading && filas.length === 0 && (
        <Card className="p-12 text-center">
          <Archive size={28} className="mx-auto mb-3 text-ink-300" />
          <p className="font-display text-xl text-ink">
            {q.trim() ? `Sin coincidencias para “${q.trim()}”` : 'El archivo está vacío'}
          </p>
          <p className="mt-2 text-sm text-charcoal-soft">
            {q.trim()
              ? 'Prueba con otro nombre, o con el código del evento.'
              : 'Los eventos entran aquí al día siguiente de su fecha.'}
          </p>
        </Card>
      )}

      {filas.length > 0 && (
        <Card className="p-0">
          <ul className="divide-y divide-cream-200">
            {filas.map((f) => (
              <Renglon
                key={f.id}
                f={f}
                abierto={abierto === f.id}
                onAbrir={() => setAbierto(abierto === f.id ? null : f.id)}
              />
            ))}
          </ul>
        </Card>
      )}

      {data && data.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-charcoal-soft">
          <span>{data.total} evento(s) archivados</span>
          <span className="flex gap-2">
            {pagina > 0 && (
              <Button variant="outline" onClick={() => { setPagina((p) => p - 1); setAbierto(null); }}>
                Anterior
              </Button>
            )}
            {data.hayMas && (
              <Button variant="outline" onClick={() => { setPagina((p) => p + 1); setAbierto(null); }}>
                Siguientes
              </Button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function Renglon({
  f,
  abierto,
  onAbrir,
}: {
  f: RenglonHistorico;
  abierto: boolean;
  onAbrir: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        aria-expanded={abierto}
        className="flex w-full flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-4 text-left hover:bg-cream-100/70"
      >
        <span className="min-w-[12rem] flex-1">
          <span className="font-display text-lg text-ink">{f.cliente}</span>
          <span className="mt-0.5 block text-xs uppercase tracking-wide text-gold">
            {f.eventoTipo}
          </span>
          {f.codigo && (
            <span className="mt-0.5 block font-mono text-[0.7rem] tracking-tight text-charcoal-soft">
              {f.codigo}
            </span>
          )}
        </span>
        <span className="flex flex-col text-sm text-charcoal-soft">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={14} className="text-ink-300" /> {formatEventDate(f.fechaEventoISO)}
          </span>
          <span className="mt-0.5 text-[0.7rem]">{f.espacios.join(' · ')}</span>
        </span>
        <span className="text-right">
          <span className="block font-display text-xl text-ink">{formatMXN(f.total)}</span>
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            {/* Un evento pasado con saldo no debería existir: se marca, no se
                deja como un número más. */}
            {f.saldo > 0 && f.seRealizo && (
              <span className="rounded-full bg-wine/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-wine">
                debe {formatMXN(f.saldo)}
              </span>
            )}
            {!f.seRealizo && (
              <span
                title="Quedó en borrador: nunca apartó la fecha, el evento no se hizo"
                className="rounded-full bg-ink/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-charcoal-soft"
              >
                no se realizó
              </span>
            )}
            {f.liquidado && (
              <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-700">
                liquidado
              </span>
            )}
            {f.versiones > 1 && (
              <span
                title={`Esta foto se corrigió después: tiene ${f.versiones} versiones`}
                className="rounded-full bg-gold/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-gold"
              >
                {f.versiones} versiones
              </span>
            )}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-charcoal-soft">
          <Users size={13} /> {f.banquetero ?? '—'}
        </span>
      </button>
      {abierto && <FotoEventoVista id={f.id} />}
    </li>
  );
}
