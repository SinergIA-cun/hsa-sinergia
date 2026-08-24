import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';
import type { DetalleAuditoria } from '../../lib/types.ts';

/** Un valor de la fila, listo para leerse. `null` se dice, no se deja en blanco. */
function comoTexto(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * El antes y el después de una fila.
 *
 * En un UPDATE se pintan **solo los campos que cambiaron**: una cotización tiene
 * treinta columnas y ver las veintiocho que siguen igual esconde las dos que se
 * movieron. En un INSERT o un DELETE se pinta la fila entera, porque ahí la fila
 * entera es la noticia — sobre todo en el DELETE, donde es lo único que queda.
 */
export function AuditoriaDetalle({ id }: { id: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['auditoria-detalle', id],
    queryFn: () => api.get<DetalleAuditoria>(`/api/admin/auditoria/${id}`),
  });

  if (isLoading) return <p className="px-4 pb-4 text-sm text-charcoal-soft">Cargando…</p>;
  if (isError || !data) return <p className="px-4 pb-4 text-sm text-wine">No se pudo cargar.</p>;

  const antes = data.antes ?? {};
  const despues = data.despues ?? {};
  const llaves =
    data.operacion === 'UPDATE'
      ? data.campos
      : [...new Set([...Object.keys(antes), ...Object.keys(despues)])].sort();

  return (
    <div className="border-t border-cream-200 bg-cream-100/60 px-4 py-4">
      <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-charcoal-soft">
        <div>
          <dt className="inline font-medium">Origen: </dt>
          <dd className="inline">{data.aplicacion ?? 'desconocido'}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Usuario de base: </dt>
          <dd className="inline">{data.usuarioDb}</dd>
        </div>
        {data.direccionIp && (
          <div>
            <dt className="inline font-medium">Desde: </dt>
            <dd className="inline">{data.direccionIp}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-medium">Transacción: </dt>
          <dd className="inline font-mono">{data.txid}</dd>
        </div>
        {data.registroId && (
          <div>
            <dt className="inline font-medium">Registro: </dt>
            <dd className="inline font-mono">{data.registroId}</dd>
          </div>
        )}
      </dl>

      {llaves.length === 0 ? (
        <p className="text-sm text-charcoal-soft">
          {data.operacion === 'TRUNCATE'
            ? 'TRUNCATE no deja las filas que se llevó: Postgres no se las da al trigger. Queda el hecho, y el hecho ya es grave.'
            : 'Sin campos que mostrar.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="text-[0.65rem] uppercase tracking-wide text-charcoal-soft">
                <th className="pb-1 pr-4 font-medium">Campo</th>
                <th className="pb-1 pr-4 font-medium">Antes</th>
                <th className="pb-1 font-medium">Después</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-200">
              {llaves.map((k) => (
                <tr key={k}>
                  <td className="py-1.5 pr-4 align-top font-mono text-xs text-ink">{k}</td>
                  <td className="py-1.5 pr-4 align-top text-charcoal-soft">
                    {comoTexto(antes[k])}
                  </td>
                  <td className="py-1.5 align-top text-ink">{comoTexto(despues[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
