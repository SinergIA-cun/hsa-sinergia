import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Cog, ShieldAlert, Terminal, UserCircle } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatFechaHora } from '../lib/date.ts';
import { ArrowDivider, Button, Card, SelectInput } from '../components/ui.tsx';
import { AuditoriaDetalle } from '../components/auditoria/AuditoriaDetalle.tsx';
import type { OrigenAuditoria, PaginaAuditoria, RenglonAuditoria } from '../lib/types.ts';

const OPERACIONES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const;

const ORIGENES: { valor: OrigenAuditoria; etiqueta: string }[] = [
  { valor: 'externo', etiqueta: 'Fuera de la aplicación' },
  { valor: 'persona', etiqueta: 'Una persona en la app' },
  { valor: 'sistema', etiqueta: 'Procesos del sistema' },
];

const ESTILO_OPERACION: Record<string, string> = {
  INSERT: 'bg-emerald-600/10 text-emerald-700',
  UPDATE: 'bg-gold/20 text-gold',
  DELETE: 'bg-wine/10 text-wine',
  TRUNCATE: 'bg-wine text-white',
};

/**
 * La bitácora forense.
 *
 * No es la línea de tiempo del evento —esa cuenta la historia en palabras y la
 * lee el equipo todos los días—. Ésta guarda la fila completa antes y después,
 * y la escriben triggers de Postgres, así que ve el cambio venga de donde venga.
 *
 * Toda la pantalla está construida alrededor de una sola pregunta: **¿qué
 * cambió sin pasar por la app?** Por eso lo que no trae actor no se pinta como
 * un renglón más, sino marcado.
 */
export function AuditoriaPage() {
  const [tabla, setTabla] = useState('');
  const [operacion, setOperacion] = useState('');
  const [origen, setOrigen] = useState<'' | OrigenAuditoria>('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [paginas, setPaginas] = useState<string[]>([]);

  const antesDe = paginas[paginas.length - 1];
  const { data, isLoading } = useQuery({
    queryKey: ['auditoria', tabla, operacion, origen, antesDe ?? ''],
    queryFn: () => {
      const p = new URLSearchParams();
      if (tabla) p.set('tabla', tabla);
      if (operacion) p.set('operacion', operacion);
      if (origen) p.set('origen', origen);
      if (antesDe) p.set('antesDe', antesDe);
      return api.get<PaginaAuditoria>(`/api/admin/auditoria?${p.toString()}`);
    },
  });

  function reiniciar(cambio: () => void) {
    cambio();
    setPaginas([]);
    setAbierto(null);
  }

  const filas = data?.filas ?? [];
  const externos = data?.externosRecientes ?? 0;

  return (
    <div>
      <Link
        to="/admin"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal-soft hover:text-ink"
      >
        <ArrowLeft size={15} /> Panel de admin
      </Link>

      <div className="mb-6">
        <ArrowDivider>Auditoría</ArrowDivider>
        <h1 className="mt-2 font-display text-4xl text-ink">Bitácora forense</h1>
        <p className="mt-1 max-w-2xl text-sm text-charcoal-soft">
          La escriben los triggers de la base de datos, no la aplicación. Registra el cambio venga
          de donde venga —la app, una consola de SQL, una migración— y guarda la fila completa
          antes y después.
        </p>
      </div>

      {/* La alarma. Cuenta SOLO lo externo —otro cliente de base de datos—, no
          todo lo que viene sin actor: nuestros propios backfills tampoco traen
          persona, y si contaran aquí la alarma sonaría en cada despliegue hasta
          que nadie la mirara. */}
      {externos > 0 && (
        <button
          type="button"
          onClick={() => reiniciar(() => setOrigen('externo'))}
          className="mb-6 flex w-full items-center gap-3 rounded-lg border-l-4 border-wine bg-wine/10 px-4 py-3 text-left text-sm text-ink transition-colors hover:bg-wine/15"
        >
          <ShieldAlert size={18} className="shrink-0 text-wine" />
          <span>
            <strong className="font-display text-lg">{externos}</strong> cambio(s) de los últimos 30
            días <strong>no vinieron de la aplicación</strong>. Toca para verlos.
          </span>
        </button>
      )}

      <Card className="mb-5 flex flex-wrap items-end gap-4 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-charcoal-soft">
            Tabla
          </span>
          <SelectInput value={tabla} onChange={(e) => reiniciar(() => setTabla(e.target.value))}>
            <option value="">Todas</option>
            {(data?.tablas ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-charcoal-soft">
            Operación
          </span>
          <SelectInput
            value={operacion}
            onChange={(e) => reiniciar(() => setOperacion(e.target.value))}
          >
            <option value="">Todas</option>
            {OPERACIONES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-charcoal-soft">
            Origen
          </span>
          <SelectInput
            value={origen}
            onChange={(e) => reiniciar(() => setOrigen(e.target.value as '' | OrigenAuditoria))}
          >
            <option value="">Todos</option>
            {ORIGENES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </SelectInput>
        </label>
      </Card>

      {isLoading && <p className="text-charcoal-soft">Cargando…</p>}

      {!isLoading && filas.length === 0 && (
        <Card className="p-10 text-center">
          <p className="font-display text-xl text-ink">Sin movimientos</p>
          <p className="mt-2 text-sm text-charcoal-soft">
            {origen === 'externo'
              ? 'Nada entró por fuera de la aplicación. Es la respuesta que se quiere.'
              : 'Ningún cambio cae en estos filtros.'}
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

      <div className="mt-4 flex justify-between">
        {paginas.length > 0 ? (
          <Button
            variant="outline"
            onClick={() => {
              setPaginas((p) => p.slice(0, -1));
              setAbierto(null);
            }}
          >
            Anterior
          </Button>
        ) : (
          <span />
        )}
        {data?.siguienteCursor && (
          <Button
            variant="outline"
            onClick={() => {
              setPaginas((p) => [...p, data.siguienteCursor!]);
              setAbierto(null);
            }}
          >
            Siguientes
          </Button>
        )}
      </div>
    </div>
  );
}

/** El sello de origen. Es lo primero que se busca al abrir esta pantalla. */
function SelloOrigen({ f }: { f: RenglonAuditoria }) {
  if (f.origen === 'externo') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-wine/15 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-wine"
        title={`Origen: ${f.aplicacion || 'sin identificar'} · usuario de base ${f.usuarioDb}`}
      >
        <Terminal size={12} /> fuera de la app
      </span>
    );
  }
  if (f.origen === 'sistema') {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-charcoal-soft"
        title="Nuestro propio código sin persona detrás: migración, backfill o arranque"
      >
        <Cog size={13} /> sistema
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-charcoal-soft">
      <UserCircle size={13} /> {f.actorNombre}
    </span>
  );
}

function Renglon({
  f,
  abierto,
  onAbrir,
}: {
  f: RenglonAuditoria;
  abierto: boolean;
  onAbrir: () => void;
}) {
  return (
    <li className={f.origen === 'externo' ? 'bg-wine/[0.04]' : undefined}>
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-cream-100/70"
        aria-expanded={abierto}
      >
        <span className="w-44 shrink-0 text-xs tabular-nums text-charcoal-soft">
          {formatFechaHora(f.createdAt)}
        </span>
        <span
          className={`inline-block w-24 shrink-0 rounded px-2 py-0.5 text-center text-[0.65rem] font-semibold uppercase tracking-wide ${
            ESTILO_OPERACION[f.operacion] ?? 'bg-ink/10 text-ink'
          }`}
        >
          {f.operacion}
        </span>
        <span className="min-w-[8rem] flex-1">
          <span className="font-medium text-ink">{f.tabla}</span>
          {f.registroId && (
            <span className="ml-2 font-mono text-[0.7rem] text-charcoal-soft">
              {f.registroId.slice(-8)}
            </span>
          )}
          {f.campos.length > 0 && (
            <span className="mt-0.5 block text-xs text-charcoal-soft">
              {f.campos.join(', ')}
            </span>
          )}
        </span>
        <SelloOrigen f={f} />
      </button>
      {abierto && <AuditoriaDetalle id={f.id} />}
    </li>
  );
}
