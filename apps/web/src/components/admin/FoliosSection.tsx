import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash } from 'lucide-react';
import { formatFolio } from '@hsa/shared';
import { api } from '../../lib/api.ts';
import { formatTimestamp } from '../../lib/date.ts';
import { Button, Card, Field, TextInput } from '../ui.tsx';
import { apiErrorMessage } from './shared.tsx';

interface EstadoFolios {
  serie: string;
  siguiente: number;
  siguienteTexto: string;
  ultimoUsado: number | null;
  cambios: { id: string; siguiente: number; anterior: number; actor: string | null; createdAt: string }[];
}

/**
 * El folio con el que sigue la serie I.
 *
 * La hacienda lleva años usando hojas foliadas y el sistema tiene que seguir la
 * misma numeración: si la última hoja de papel fue la I 5331, aquí se captura
 * 5332 y el siguiente dinero que entre lleva ese número. Nada de lo ya
 * registrado se renumera (decisión del dueño).
 */
export function FoliosSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-folios'],
    queryFn: () => api.get<EstadoFolios>('/api/admin/folios'),
  });
  const [siguiente, setSiguiente] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const fijar = useMutation({
    mutationFn: (n: number) => api.put<EstadoFolios>('/api/admin/folios', { siguiente: n }),
    onSuccess: async (estado) => {
      setSiguiente('');
      setError('');
      setOk(`Listo: el siguiente dinero que entre llevará el folio ${estado.siguienteTexto}.`);
      await qc.invalidateQueries({ queryKey: ['admin-folios'] });
    },
    onError: (e) => {
      setOk('');
      setError(apiErrorMessage(e, 'No se pudo cambiar el folio.'));
    },
  });

  function guardar(e: FormEvent) {
    e.preventDefault();
    const n = Number(siguiente);
    if (!(n > 0)) {
      setError('Captura el número con el que sigue la serie.');
      return;
    }
    if (!window.confirm(`El siguiente pago, depósito o abono llevará el folio ${formatFolio(n)}. ¿Continuar?`)) return;
    fijar.mutate(n);
  }

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl text-ink">Folios de recibo</h2>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <Hash size={22} className="mt-1 shrink-0 text-gold" />
            <div className="space-y-2 text-sm text-charcoal">
              <p>
                Cada dinero que entra lleva un folio de la serie <strong>I</strong>: un pago, un
                depósito de banquetero o un abono a una fecha apartada. Repartir un depósito entre
                varios eventos <strong>no</strong> gasta folios: todos llevan el del depósito.
              </p>
              {data && (
                <p className="font-display text-3xl text-ink">
                  Siguiente: {data.siguienteTexto}
                </p>
              )}
              {data?.ultimoUsado != null && (
                <p className="text-xs text-charcoal-soft">
                  El último folio usado es el {formatFolio(data.ultimoUsado)}.
                </p>
              )}
            </div>
          </div>
          {data && data.cambios.length > 0 && (
            <ul className="mt-5 space-y-1 border-t border-cream-200 pt-3 text-xs text-charcoal-soft">
              {data.cambios.map((c) => (
                <li key={c.id}>
                  {formatTimestamp(c.createdAt)} · {c.actor ?? 'Sistema'} fijó el siguiente en{' '}
                  {formatFolio(c.siguiente)} (iba en {formatFolio(c.anterior)})
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4 p-6">
          <h3 className="font-display text-lg text-ink">Folio con el que arrancamos</h3>
          <form onSubmit={guardar} className="space-y-4">
            <Field
              label="Siguiente folio"
              hint="El número de la próxima hoja. Si la última de papel fue I 5331, aquí va 5332."
            >
              {/* Texto y no MoneyInput: un folio no lleva comas de millar. */}
              <TextInput
                inputMode="numeric"
                value={siguiente}
                onChange={(e) => setSiguiente(e.target.value.replace(/\D/g, ''))}
                placeholder="5332"
              />
            </Field>
            {error && <p className="text-sm text-wine">{error}</p>}
            {ok && <p className="text-sm text-emerald-700">{ok}</p>}
            <Button type="submit" variant="gold" disabled={fijar.isPending}>
              {fijar.isPending ? 'Guardando…' : 'Fijar folio'}
            </Button>
          </form>
        </Card>
      </div>
    </section>
  );
}
