import { useMemo, useState } from 'react';
import { formatMXN } from '../../../lib/money.ts';
import { TextInput } from '../../ui.tsx';
import { BarraGuardar, useGuardar } from './guardado.tsx';

export interface DjCambio {
  eventTypeId: string;
  /** `null` QUITA el renglón: así se apaga el servicio en ese tipo de evento. */
  price: number | null;
}

/**
 * El precio del DJ por hora extra, un renglón por tipo de evento.
 *
 * **Dejar el campo vacío quita el renglón, y eso es cómo se apaga el servicio**:
 * el motor no cobra el DJ de un tipo de evento sin renglón, aunque la casilla de
 * la cotización venga marcada. No hay bandera "activo" que pueda desalinearse
 * con el precio.
 */
export function DjSeccion({
  dj,
  eventTypes,
  onGuardar,
}: {
  dj: { eventTypeId: string; price: number }[];
  eventTypes: { id: string; nombre: string }[];
  onGuardar: (cambios: DjCambio[]) => Promise<unknown>;
}) {
  const actual = useMemo(() => new Map(dj.map((d) => [d.eventTypeId, d.price])), [dj]);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [invalido, setInvalido] = useState('');
  const { correr, pendiente, error, ok, limpiar } = useGuardar('No se pudo guardar el DJ.');

  const valor = (id: string) => borrador[id] ?? (actual.has(id) ? String(actual.get(id)) : '');

  /** Un precio capturado: entero ≥ 0, o `null` si el campo quedó vacío. */
  function leer(v: string): number | null | 'malo' {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : 'malo';
  }

  const cambios = useMemo(() => {
    const out: DjCambio[] = [];
    for (const [eventTypeId, crudo] of Object.entries(borrador)) {
      const leido = leer(crudo);
      if (leido === 'malo') continue;
      const antes = actual.has(eventTypeId) ? actual.get(eventTypeId)! : null;
      if (leido === antes) continue;
      out.push({ eventTypeId, price: leido });
    }
    return out;
  }, [borrador, actual]);

  const hayMalos = Object.values(borrador).some((v) => leer(v) === 'malo');

  async function guardar() {
    if (hayMalos) {
      setInvalido('El precio del DJ va en pesos enteros. Deja el campo vacío para no cobrarlo.');
      return;
    }
    setInvalido('');
    const enviados = cambios;
    const quitados = enviados.filter((c) => c.price === null).length;
    const bien = await correr(
      () => onGuardar(enviados),
      quitados > 0
        ? `Guardado; ${quitados} tipo${quitados === 1 ? '' : 's'} de evento ya no cobra${quitados === 1 ? '' : 'n'} DJ.`
        : 'Precios del DJ guardados.',
    );
    if (bien) setBorrador({});
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-charcoal-soft">
        Un tipo de evento sin precio no ofrece el servicio: vacía el campo para retirarlo y captura un
        precio para volver a ofrecerlo.
      </p>
      <ul className="divide-y divide-cream-300">
        {eventTypes.map((t) => {
          const crudo = valor(t.id);
          const malo = leer(crudo) === 'malo';
          const antes = actual.get(t.id);
          return (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm text-ink">{t.nombre}</p>
                <p className="text-xs text-charcoal-soft">
                  {antes === undefined ? 'No cobra DJ por hora extra' : `Ahora: ${formatMXN(antes)}`}
                </p>
              </div>
              <TextInput
                type="number"
                min={0}
                step={1}
                aria-label={`DJ hora extra en ${t.nombre}`}
                placeholder="no se cobra"
                className={`w-36 px-2.5 py-1.5 text-sm ${malo ? 'border-wine' : ''}`}
                value={crudo}
                onChange={(e) => {
                  limpiar();
                  setInvalido('');
                  setBorrador((prev) => ({ ...prev, [t.id]: e.target.value }));
                }}
              />
            </li>
          );
        })}
      </ul>
      <BarraGuardar
        cambios={cambios.length}
        pendiente={pendiente}
        error={invalido || error}
        ok={ok}
        onGuardar={() => void guardar()}
        onDescartar={() => {
          setBorrador({});
          setInvalido('');
          limpiar();
        }}
        etiqueta="Guardar DJ"
        unidad="tipo de evento"
      />
    </div>
  );
}
