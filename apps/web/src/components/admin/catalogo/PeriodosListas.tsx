import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Trash2 } from 'lucide-react';
import { diasDePeriodo, type PeriodoLista } from '@hsa/shared';
import { api } from '../../../lib/api.ts';
import { formatEventDate } from '../../../lib/date.ts';
import { Button, Card, Field, SelectInput, TextInput } from '../../ui.tsx';
import type { PriceList } from '../../../lib/types.ts';
import { apiErrorMessage } from '../shared.tsx';

const PERIODOS_KEY = ['periodos-lista'] as const;

type Modo = 'anio' | 'mes' | 'rango';

const MODOS: { valor: Modo; etiqueta: string }[] = [
  { valor: 'anio', etiqueta: 'Año completo' },
  { valor: 'mes', etiqueta: 'Un mes' },
  { valor: 'rango', etiqueta: 'Rango de días' },
];

/** Último día de un mes `YYYY-MM` (28–31). */
function finDeMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return `${mes}-${String(ultimo).padStart(2, '0')}`;
}

/** Convierte lo capturado en `desde`/`hasta`, o `null` si falta algo. */
function rangoDe(modo: Modo, anio: string, mes: string, desde: string, hasta: string) {
  if (modo === 'anio') return /^\d{4}$/.test(anio) ? { desde: `${anio}-01-01`, hasta: `${anio}-12-31` } : null;
  if (modo === 'mes') return /^\d{4}-\d{2}$/.test(mes) ? { desde: `${mes}-01`, hasta: finDeMes(mes) } : null;
  return desde && hasta ? { desde, hasta } : null;
}

/**
 * Periodos de fechas ↔ lista de precios (24-nov-2026).
 *
 * Al cotizar, la fecha del evento escoge la lista sola y ventas ya no la elige.
 * Si dos periodos cubren la misma fecha gana el más corto, así que "diciembre"
 * puede ir dentro de "todo el año" sin pelearse.
 */
export function PeriodosListas({ priceLists }: { priceLists: PriceList[] }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: PERIODOS_KEY,
    queryFn: () => api.get<{ periodos: PeriodoLista[] }>('/api/admin/periodos-lista'),
  });
  const periodos = data?.periodos ?? [];
  const nombreDe = useMemo(() => new Map(priceLists.map((p) => [p.id, p.nombre])), [priceLists]);

  const [priceListId, setPriceListId] = useState('');
  const [modo, setModo] = useState<Modo>('anio');
  const [anio, setAnio] = useState(String(new Date().getFullYear() + 1));
  const [mes, setMes] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');

  async function refrescar() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: PERIODOS_KEY }),
      // La pantalla de cotizar lee los periodos de aquí.
      qc.invalidateQueries({ queryKey: ['price-lists-elegibles'] }),
    ]);
  }

  const crear = useMutation({
    mutationFn: (body: { priceListId: string; desde: string; hasta: string; nota: string | null }) =>
      api.post<{ periodo: PeriodoLista }>('/api/admin/periodos-lista', body),
    onSuccess: async () => {
      setNota('');
      setError('');
      await refrescar();
    },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo guardar el periodo.')),
  });

  const quitar = useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/api/admin/periodos-lista/${id}`),
    onSuccess: refrescar,
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo quitar el periodo.')),
  });

  const lista = priceListId || priceLists[0]?.id || '';
  const rango = rangoDe(modo, anio, mes, desde, hasta);

  function agregar(e: FormEvent) {
    e.preventDefault();
    if (!lista || !rango) {
      setError('Escoge la lista y las fechas.');
      return;
    }
    if (rango.desde > rango.hasta) {
      setError('La fecha de inicio no puede ser después de la final.');
      return;
    }
    crear.mutate({ priceListId: lista, ...rango, nota: nota.trim() || null });
  }

  return (
    <Card className="p-6">
      <h3 className="flex items-center gap-2 font-display text-xl text-ink">
        <CalendarRange size={18} className="text-gold" /> Fechas de cada lista
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-charcoal-soft">
        Al cotizar, la fecha del evento escoge la lista sola y ventas ya no la elige. Si dos periodos
        cubren la misma fecha, gana el más corto: puedes poner diciembre con otra lista dentro del año
        completo.
      </p>

      <form onSubmit={agregar} className="mt-5 grid gap-4 rounded-xl border border-ink/10 bg-cream-100/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Lista">
          <SelectInput value={lista} onChange={(e) => setPriceListId(e.target.value)}>
            {priceLists.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Cubre">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Qué cubre el periodo">
            {MODOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                role="radio"
                aria-checked={modo === m.valor}
                onClick={() => setModo(m.valor)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  modo === m.valor ? 'bg-ink text-cream' : 'border border-ink/20 text-ink hover:bg-ink/5'
                }`}
              >
                {m.etiqueta}
              </button>
            ))}
          </div>
        </Field>

        {modo === 'anio' && (
          <Field label="Año">
            <TextInput inputMode="numeric" maxLength={4} value={anio} onChange={(e) => setAnio(e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        {modo === 'mes' && (
          <Field label="Mes">
            <TextInput type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </Field>
        )}
        {modo === 'rango' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Desde">
              <TextInput type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </Field>
            <Field label="Hasta">
              <TextInput type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Nota (opcional)">
          <TextInput value={nota} maxLength={120} onChange={(e) => setNota(e.target.value)} placeholder="ej. Temporada alta" />
        </Field>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="gold" disabled={crear.isPending || priceLists.length === 0}>
            Agregar periodo
          </Button>
          {rango && (
            <span className="text-xs text-charcoal-soft">
              {formatEventDate(rango.desde)} → {formatEventDate(rango.hasta)}
            </span>
          )}
          {error && <span className="text-sm text-wine" role="alert">{error}</span>}
        </div>
      </form>

      <div className="mt-5">
        {isLoading && <p className="text-sm text-charcoal-soft">Cargando…</p>}
        {!isLoading && periodos.length === 0 && (
          <p className="rounded-lg border border-dashed border-ink/15 px-3 py-4 text-center text-sm text-charcoal-soft">
            Sin periodos todavía. Mientras no haya, la fecha propone el único catálogo de su año y ventas
            puede cambiarlo.
          </p>
        )}
        {periodos.length > 0 && (
          <ul className="divide-y divide-cream-300">
            {periodos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium tabular-nums text-ink">
                    {formatEventDate(p.desde)} → {formatEventDate(p.hasta)}
                    <span className="ml-2 text-xs font-normal text-charcoal-soft">{diasDePeriodo(p)} días</span>
                  </p>
                  <p className="text-xs text-charcoal-soft">
                    <span className="font-semibold text-gold">{nombreDe.get(p.priceListId) ?? 'Lista borrada'}</span>
                    {p.nota ? ` · ${p.nota}` : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Quitar el periodo del ${p.desde} al ${p.hasta}`}
                  disabled={quitar.isPending}
                  onClick={() => quitar.mutate(p.id)}
                >
                  <Trash2 size={15} /> Quitar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
