import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import { Button, Card, ArrowDivider } from '../components/ui.tsx';
import type { Quote } from '../lib/types.ts';

const RETENTION_DAYS = 30;

function diasRestantes(deletedAt: string): number {
  const borrado = new Date(deletedAt).getTime();
  const transcurridos = (Date.now() - borrado) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(RETENTION_DAYS - transcurridos));
}

export function PapeleraPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: () => api.get<{ quotes: Quote[] }>('/api/quotes/trash'),
  });
  const quotes = data?.quotes ?? [];

  async function restaurar(id: string) {
    await api.post(`/api/quotes/${id}/restore`);
    await qc.invalidateQueries({ queryKey: ['trash'] });
    await qc.invalidateQueries({ queryKey: ['quotes'] });
  }

  return (
    <div>
      <div className="mb-6">
        <ArrowDivider>Papelera</ArrowDivider>
        <h1 className="mt-2 font-display text-4xl text-ink">Cotizaciones eliminadas</h1>
        <p className="mt-1 text-sm text-charcoal-soft">
          Se conservan {RETENTION_DAYS} días y luego se eliminan definitivamente.
        </p>
      </div>

      {isLoading && <p className="text-charcoal-soft">Cargando…</p>}

      {!isLoading && quotes.length === 0 && (
        <Card className="p-12 text-center">
          <Trash2 className="mx-auto text-ink-300" size={28} />
          <p className="mt-3 font-display text-2xl text-ink">La papelera está vacía</p>
        </Card>
      )}

      <div className="grid gap-3">
        {quotes.map((q) => (
          <Card key={q.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-[11rem] flex-1">
              <p className="font-display text-xl text-ink">{q.client?.nombre ?? 'Cliente'}</p>
              <p className="text-xs uppercase tracking-wide text-gold">{q.eventType?.nombre ?? 'Evento'}</p>
            </div>
            <div className="text-sm text-charcoal-soft">
              <p>Evento: {formatEventDate(q.fechaEvento)}</p>
              {q.deletedAt && (
                <p className="text-xs text-charcoal-soft/70">
                  eliminada {formatTimestamp(q.deletedAt)} · {diasRestantes(q.deletedAt)} días para borrarse
                </p>
              )}
            </div>
            <p className="font-display text-xl text-ink">{formatMXN(q.total)}</p>
            <Button variant="outline" onClick={() => void restaurar(q.id)}>
              <RotateCcw size={15} /> Restaurar
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
