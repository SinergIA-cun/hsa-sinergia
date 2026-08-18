import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../../lib/api.ts';
import {
  PRICE_LISTS_KEY,
  useCatalogoBitacora,
  useCatalogoContenido,
  useCatalogoImpacto,
  useInvalidarCatalogo,
} from '../../../lib/catalogos.ts';
import { Button, Card } from '../../ui.tsx';
import type { PriceList } from '../../../lib/types.ts';
import { apiErrorMessage } from '../shared.tsx';
import { AvisoImpacto } from './AvisoImpacto.tsx';
import { BitacoraCatalogo } from './BitacoraCatalogo.tsx';
import { RentaSeccion, type RentaCambio } from './RentaSeccion.tsx';
import {
  ServiciosSeccion,
  type ServicioNuevo,
  type ServicioPatch,
} from './ServiciosSeccion.tsx';
import {
  AlimentosSeccion,
  type PaqueteNuevo,
  type PaquetePatch,
} from './AlimentosSeccion.tsx';
import { DjSeccion, type DjCambio } from './DjSeccion.tsx';
import { ParametrosSeccion, type ParametrosPatch } from './ParametrosSeccion.tsx';

const SECCIONES = ['renta', 'servicios', 'alimentos', 'dj', 'parametros'] as const;
type Seccion = (typeof SECCIONES)[number];

const SECCION_LABEL: Record<Seccion, string> = {
  renta: 'Renta',
  servicios: 'Servicios',
  alimentos: 'Alimentos',
  dj: 'DJ',
  parametros: 'Parámetros',
};

/**
 * El editor del contenido de un catálogo: renta, servicios, alimentos, DJ y
 * parámetros.
 *
 * Se guarda POR SECCIÓN, nunca todo de golpe: la bitácora tiene que poder decir
 * qué se cambió, y un solo botón para 37 renglones de renta más los servicios
 * deja un renglón que dice "se editó el catálogo" y no sirve para reconstruir
 * nada. En renta se mandan además solo los renglones tocados.
 *
 * Editar un catálogo en uso está permitido —decisión del dueño, que eligió la
 * flexibilidad a conciencia—, así que el aviso de impacto informa y ofrece la
 * salida (clonar) pero NO bloquea.
 */
export function CatalogoEditor({
  priceListId,
  onCerrar,
  onCambiarCatalogo,
}: {
  priceListId: string;
  onCerrar: () => void;
  onCambiarCatalogo: (id: string) => void;
}) {
  const qc = useQueryClient();
  const contenidoQ = useCatalogoContenido(priceListId);
  const impactoQ = useCatalogoImpacto(priceListId);
  const bitacoraQ = useCatalogoBitacora(priceListId);
  const invalidar = useInvalidarCatalogo(priceListId);
  const [seccion, setSeccion] = useState<Seccion>('renta');

  const base = `/api/admin/price-lists/${priceListId}`;

  /**
   * Toda mutación pasa por aquí para refrescar lo mismo: contenido, impacto,
   * bitácora, el listado y —la que se olvida— la del cotizador. Sin esa última,
   * el formulario sigue calculando con los precios viejos.
   */
  async function conInvalidacion<T>(hacer: () => Promise<T>): Promise<T> {
    const res = await hacer();
    await invalidar();
    return res;
  }

  async function clonar(datos: { nombre: string; anio: number; incrementoPct?: number }) {
    const { priceList } = await api.post<{ priceList: PriceList }>('/api/admin/price-lists', {
      ...datos,
      clonarDe: priceListId,
    });
    await qc.invalidateQueries({ queryKey: PRICE_LISTS_KEY });
    onCambiarCatalogo(priceList.id);
    return priceList;
  }

  if (contenidoQ.isLoading) {
    return <p className="text-sm text-charcoal-soft">Cargando el catálogo…</p>;
  }
  if (contenidoQ.error || !contenidoQ.data) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-wine">
          {apiErrorMessage(contenidoQ.error, 'No se pudo cargar el catálogo.')}
        </p>
        <Button type="button" variant="outline" className="px-3 py-1.5 text-xs" onClick={onCerrar}>
          <ArrowLeft size={13} /> Volver a la lista
        </Button>
      </div>
    );
  }

  const c = contenidoQ.data.contenido;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-xl text-ink">
            Editando {c.priceList.nombre}
            {c.priceList.activa && (
              <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gold">
                Activo
              </span>
            )}
          </h3>
          <p className="text-xs text-charcoal-soft">
            Año {c.priceList.anio} · {c.renta.length} renglones de renta · {c.servicios.length}{' '}
            servicios · {c.paquetes.length} paquetes
          </p>
        </div>
        <Button type="button" variant="outline" className="px-3 py-1.5 text-xs" onClick={onCerrar}>
          <ArrowLeft size={13} /> Volver a la lista
        </Button>
      </div>

      {impactoQ.data && <AvisoImpacto impacto={impactoQ.data.impacto} onClonar={clonar} />}

      <nav className="flex flex-wrap gap-1 border-b border-cream-300" aria-label="Secciones del catálogo">
        {SECCIONES.map((s) => (
          <button
            key={s}
            type="button"
            aria-current={seccion === s ? 'page' : undefined}
            onClick={() => setSeccion(s)}
            className={`-mb-px rounded-t-lg px-3 py-2 text-sm transition-colors ${
              seccion === s
                ? 'border-b-2 border-gold font-medium text-ink'
                : 'text-charcoal-soft hover:text-ink'
            }`}
          >
            {SECCION_LABEL[s]}
          </button>
        ))}
      </nav>

      <Card className="p-5">
        {seccion === 'renta' && (
          <RentaSeccion
            renta={c.renta}
            onGuardar={(cambios: RentaCambio[]) =>
              conInvalidacion(() => api.patch(`${base}/rentas`, { cambios }))
            }
          />
        )}
        {seccion === 'servicios' && (
          <ServiciosSeccion
            servicios={c.servicios}
            onCrear={(datos: ServicioNuevo) =>
              conInvalidacion(() => api.post(`${base}/servicios`, datos))
            }
            onEditar={(id: string, datos: ServicioPatch) =>
              conInvalidacion(() => api.patch(`${base}/servicios/${id}`, datos))
            }
            onBorrar={(id: string) => conInvalidacion(() => api.del(`${base}/servicios/${id}`))}
          />
        )}
        {seccion === 'alimentos' && (
          <AlimentosSeccion
            paquetes={c.paquetes}
            eventTypes={c.eventTypes}
            onCrear={(datos: PaqueteNuevo) =>
              conInvalidacion(() => api.post(`${base}/paquetes`, datos))
            }
            onEditar={(id: string, datos: PaquetePatch) =>
              conInvalidacion(() => api.patch(`${base}/paquetes/${id}`, datos))
            }
            onBorrar={(id: string) => conInvalidacion(() => api.del(`${base}/paquetes/${id}`))}
          />
        )}
        {seccion === 'dj' && (
          <DjSeccion
            dj={c.dj}
            eventTypes={c.eventTypes}
            onGuardar={(precios: DjCambio[]) =>
              conInvalidacion(() => api.patch(`${base}/dj`, { precios }))
            }
          />
        )}
        {seccion === 'parametros' && (
          <ParametrosSeccion
            params={c.priceList}
            onGuardar={(datos: ParametrosPatch) =>
              conInvalidacion(() => api.patch(`${base}/parametros`, datos))
            }
          />
        )}
      </Card>

      <BitacoraCatalogo
        bitacora={bitacoraQ.data?.bitacora ?? []}
        cargando={bitacoraQ.isLoading}
      />
    </div>
  );
}
