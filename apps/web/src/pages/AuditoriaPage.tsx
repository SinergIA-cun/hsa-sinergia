import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Cog, ShieldAlert, Terminal, UserCircle } from 'lucide-react';
import { agruparPorTransaccion, seMuestraSinRuido, type GrupoAuditoria } from '@hsa/shared';
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

/**
 * La operación ya no se escribe: se pinta.
 *
 * Antes cada renglón traía la palabra INSERT o DELETE en una etiqueta ancha. Con
 * la frase adelante —"Borró una lista de precios"— la palabra sobraba y le
 * quitaba lugar justo a lo que hay que leer. Queda el color, que es lo que sirve
 * para barrer la lista con la vista, y el nombre técnico en el `title` para
 * quien lo necesite.
 */
const COLOR_OPERACION: Record<string, string> = {
  INSERT: 'bg-emerald-600',
  UPDATE: 'bg-gold',
  DELETE: 'bg-wine',
  TRUNCATE: 'bg-wine',
};

const NOMBRE_OPERACION: Record<string, string> = {
  INSERT: 'Alta de un registro (INSERT)',
  UPDATE: 'Cambio en un registro (UPDATE)',
  DELETE: 'Baja de un registro (DELETE)',
  TRUNCATE: 'Vaciado de una tabla completa (TRUNCATE)',
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
  /** Grupos cuyos renglones de consecuencia están a la vista. */
  const [desplegados, setDesplegados] = useState<Set<string>>(new Set());
  /**
   * Ver también los renglones que la base escribe sola.
   *
   * Apagado por omisión. Cada cambio de un contrato escribe además su bitácora,
   * y esos renglones llegaron a ser la mitad de la pantalla diciendo "anotó un
   * movimiento en la bitácora" — cierto, y sin ninguna información: el
   * movimiento que lo causó está en el renglón de al lado.
   *
   * Se oculta, no se borra: el contador dice cuántos son y el interruptor los
   * trae de vuelta. Y NUNCA se oculta lo que entró por fuera de la aplicación,
   * pase lo que pase: es la única pregunta que esta pantalla existe para
   * contestar, y un filtro de comodidad no puede taparla.
   */
  const [verAutomaticos, setVerAutomaticos] = useState(false);
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
    setDesplegados(new Set());
  }

  function alternarDesplegado(id: string) {
    setDesplegados((previos) => {
      const siguiente = new Set(previos);
      if (!siguiente.delete(id)) siguiente.add(id);
      return siguiente;
    });
  }

  const todas = data?.filas ?? [];
  const filas = verAutomaticos ? todas : todas.filter(seMuestraSinRuido);
  const ocultos = todas.length - filas.length;
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
          antes y después. Cada renglón dice qué pasó en palabras; abajo, en chico, va la tabla y
          la columna exactas.
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

      {(ocultos > 0 || verAutomaticos) && (
        <label className="mb-4 flex cursor-pointer items-center gap-2 text-xs text-charcoal-soft">
          <input
            type="checkbox"
            checked={verAutomaticos}
            onChange={(e) => {
              setVerAutomaticos(e.target.checked);
              setAbierto(null);
              setDesplegados(new Set());
            }}
            className="h-3.5 w-3.5 accent-gold"
          />
          {verAutomaticos
            ? 'Se están mostrando los renglones que la base escribe sola'
            : `Mostrar ${ocultos} ${ocultos === 1 ? 'renglón' : 'renglones'} que la base escribió sola en esta página`}
        </label>
      )}

      {isLoading && <p className="text-charcoal-soft">Cargando…</p>}

      {!isLoading && filas.length === 0 && (
        <Card className="p-10 text-center">
          <p className="font-display text-xl text-ink">Sin movimientos</p>
          <p className="mt-2 text-sm text-charcoal-soft">
            {origen === 'externo'
              ? 'Nada entró por fuera de la aplicación. Es la respuesta que se quiere.'
              : ocultos > 0
                ? 'Lo único de esta página son renglones que la base escribió sola. Marca la casilla de arriba para verlos.'
                : 'Ningún cambio cae en estos filtros.'}
          </p>
        </Card>
      )}

      {filas.length > 0 && (
        <Card className="p-0">
          <ul className="divide-y divide-cream-200">
            {agruparPorTransaccion(filas).map((g) => (
              <Movimiento
                key={g.id}
                g={g}
                abierto={abierto}
                onAbrir={(id) => setAbierto(abierto === id ? null : id)}
                desplegado={desplegados.has(g.id)}
                onDesplegar={() => alternarDesplegado(g.id)}
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
              setDesplegados(new Set());
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

/**
 * Un movimiento: el renglón que lo explica, y lo que la base escribió con él.
 *
 * Una sola acción deja varios renglones —el cambio, la bitácora del contrato, la
 * foto del histórico—, y borrar una lista de precios deja decenas. Sin agrupar,
 * la pantalla contaba renglones de disparador; ahora cuenta movimientos, y el
 * resto queda a un clic para quien esté auditando de verdad.
 */
function Movimiento({
  g,
  abierto,
  onAbrir,
  desplegado,
  onDesplegar,
}: {
  g: GrupoAuditoria<RenglonAuditoria>;
  abierto: string | null;
  onAbrir: (id: string) => void;
  desplegado: boolean;
  onDesplegar: () => void;
}) {
  const cuantos = g.resto.length;
  return (
    <li className={g.lider.origen === 'externo' ? 'bg-wine/[0.04]' : undefined}>
      <Renglon f={g.lider} abierto={abierto === g.lider.id} onAbrir={() => onAbrir(g.lider.id)} />
      {abierto === g.lider.id && <AuditoriaDetalle id={g.lider.id} />}

      {cuantos > 0 && (
        <button
          type="button"
          onClick={onDesplegar}
          aria-expanded={desplegado}
          className="flex w-full items-center gap-1 px-4 pb-2.5 text-left text-xs text-charcoal-soft hover:text-ink sm:pl-[13.5rem]"
        >
          <ChevronRight
            size={13}
            className={`shrink-0 transition-transform ${desplegado ? 'rotate-90' : ''}`}
          />
          {/* "de este mismo movimiento" y no "que la base escribió sola":
              en un borrado en cascada los otros renglones son bajas de verdad
              —cinco clientes borrados de un jalón—, no anotaciones automáticas.
              Lo único que se puede afirmar de todos es que fueron el mismo acto. */}
          {desplegado
            ? 'Ocultar los demás renglones'
            : `${cuantos} ${cuantos === 1 ? 'renglón' : 'renglones'} más de este mismo movimiento`}
        </button>
      )}

      {desplegado && (
        <ul className="divide-y divide-cream-200 border-t border-cream-200 bg-cream-100/40">
          {g.resto.map((f) => (
            <li key={f.id}>
              <Renglon f={f} abierto={abierto === f.id} onAbrir={() => onAbrir(f.id)} />
              {abierto === f.id && <AuditoriaDetalle id={f.id} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Un renglón.
 *
 * La frase va primero y en el color del texto normal; la tabla y la columna
 * bajan a la línea de abajo, en chico. No se quitan —son la prueba, y quien
 * audita las necesita— pero dejan de ser lo primero que se lee. El nombre del
 * registro va aparte, en monoespaciada: casi siempre es un folio, y es lo que
 * alguien viene a buscar.
 */
function Renglon({
  f,
  abierto,
  onAbrir,
}: {
  f: RenglonAuditoria;
  abierto: boolean;
  onAbrir: () => void;
}) {
  const tecnico = f.campos.length > 0 ? `${f.tabla} · ${f.campos.join(', ')}` : f.tabla;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full flex-wrap items-start gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-cream-100/70"
      aria-expanded={abierto}
    >
      <span className="w-40 shrink-0 pt-0.5 text-xs tabular-nums text-charcoal-soft">
        {formatFechaHora(f.createdAt)}
      </span>
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${COLOR_OPERACION[f.operacion] ?? 'bg-ink/30'}`}
        title={NOMBRE_OPERACION[f.operacion] ?? f.operacion}
        aria-hidden
      />
      <span className="min-w-[12rem] flex-1">
        <span className="text-ink">{f.frase}</span>
        {f.etiqueta && <span className="ml-2 font-mono text-[0.8rem] text-ink">{f.etiqueta}</span>}
        <span className="mt-0.5 block text-[0.7rem] text-charcoal-soft">
          {tecnico}
          {f.registroId && <span className="font-mono"> · {f.registroId.slice(-8)}</span>}
        </span>
      </span>
      <SelloOrigen f={f} />
    </button>
  );
}
