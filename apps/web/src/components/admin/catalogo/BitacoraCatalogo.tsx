import { formatTimestamp } from '../../../lib/date.ts';
import type { CambioCatalogo } from '../../../lib/types.ts';

const TIPO_LABEL: Record<CambioCatalogo['tipo'], string> = {
  renta: 'Renta',
  servicio: 'Servicio',
  paquete: 'Alimentos',
  dj: 'DJ',
  parametros: 'Parámetros',
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

/**
 * La bitácora del catálogo: qué se cambió, quién y cuántas cotizaciones había en
 * riesgo ENTONCES.
 *
 * El número se guardó al momento del cambio y no se recalcula al leer, a
 * propósito: la medida que importa es cuántas cotizaciones puso en riesgo quien
 * editó, ese día. Leída hoy diría otra cosa y ya no describiría el acto.
 *
 * Es una tabla aparte de la bitácora de una cotización porque `ActivityLog` exige
 * `quoteId`, y un cambio de catálogo no pertenece a ninguna cotización: pertenece
 * a todas las que cuelgan de él.
 */
export function BitacoraCatalogo({
  bitacora,
  cargando,
}: {
  bitacora: CambioCatalogo[];
  cargando: boolean;
}) {
  return (
    <section className="space-y-2 border-t border-cream-300 pt-5">
      <h3 className="font-display text-lg text-ink">Bitácora del catálogo</h3>
      {cargando && <p className="text-sm text-charcoal-soft">Cargando…</p>}
      {!cargando && bitacora.length === 0 && (
        <p className="text-sm text-charcoal-soft">
          Todavía no se ha cambiado nada en este catálogo.
        </p>
      )}
      {bitacora.length > 0 && (
        <ul className="divide-y divide-cream-200">
          {bitacora.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2 text-sm">
              <span className="rounded bg-cream-200 px-1.5 py-0.5 text-xs font-medium text-charcoal-soft">
                {TIPO_LABEL[c.tipo] ?? c.tipo}
              </span>
              <span className="text-ink">{c.descripcion}</span>
              <span className="text-xs text-charcoal-soft">
                · {formatTimestamp(c.createdAt)} {hora(c.createdAt)}
                {c.actor?.nombre ? ` · ${c.actor.nombre}` : ' · sistema'} ·{' '}
                {c.cotizacionesEnRiesgo === 0
                  ? 'ninguna cotización en riesgo entonces'
                  : `${c.cotizacionesEnRiesgo} cotización(es) en riesgo entonces`}
                {c.meta?.impacto?.comprometidas
                  ? `, ${c.meta.impacto.comprometidas} comprometida(s)`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
