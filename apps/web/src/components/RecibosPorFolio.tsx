import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Card } from './ui.tsx';

/** "I 4201", "4201", "5340-B": lo que parece un folio de recibo. */
export function pareceFolio(texto: string): boolean {
  return /^\s*(i\s*\d{3,9}|\d{3,9})\s*(-?\s*[a-z])?\s*$/i.test(texto);
}

type Resultado =
  | { tipo: 'pago'; id: string; folio: string; monto: number; fecha: string; formas: string; anulado: boolean; evento: { id: string; codigo: string | null; cliente: string | null; fecha: string } }
  | { tipo: 'deposito'; id: string; folio: string; monto: number; fecha: string; anulado: boolean; banquetero: { id: string; nombre: string } }
  | { tipo: 'abono'; id: string; folio: string; monto: number; fecha: string; anulado: boolean; apartado: { id: string; fecha: string } };

/**
 * Los recibos con ese folio, de cualquier evento (también los que ya pasaron):
 * "tengo el número de recibo, pero buscarlo en todo…" (reunión del 5-oct-2026).
 */
export function RecibosPorFolio({ folio }: { folio: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['recibos', folio.trim().toUpperCase()],
    queryFn: () => api.get<{ folio: string; resultados: Resultado[] }>(`/api/recibos?folio=${encodeURIComponent(folio.trim())}`),
  });
  if (isLoading || isError || !data) return null;

  return (
    <Card className="mb-6 p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
        <Receipt size={15} className="text-gold" /> Recibos con el folio {data.folio}
      </p>
      {data.resultados.length === 0 ? (
        <p className="text-sm text-charcoal-soft">Ningún recibo tiene ese folio.</p>
      ) : (
        <ul className="divide-y divide-cream-300">
          {data.resultados.map((r) => (
            <li key={`${r.tipo}-${r.id}`} className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${r.anulado ? 'opacity-60' : ''}`}>
              <span>
                <span className="font-mono text-xs text-charcoal-soft">{r.folio}</span>{' '}
                {r.tipo === 'pago' && (
                  <Link to={`/eventos/${r.evento.id}`} className="font-medium text-ink hover:underline">
                    {r.evento.codigo ?? 'Evento'}
                  </Link>
                )}
                {r.tipo === 'deposito' && (
                  <Link to={`/banqueteros/${r.banquetero.id}`} className="font-medium text-ink hover:underline">
                    Depósito de {r.banquetero.nombre}
                  </Link>
                )}
                {r.tipo === 'abono' && (
                  <Link to={`/apartados/${r.apartado.id}`} className="font-medium text-ink hover:underline">
                    Abono del apartado del {formatEventDate(r.apartado.fecha)}
                  </Link>
                )}
                <span className="text-charcoal-soft">
                  {r.tipo === 'pago' && r.evento.cliente && ` · ${r.evento.cliente}`} · {formatEventDate(r.fecha)}
                  {r.tipo === 'pago' && ` · ${r.formas}`}
                  {r.anulado && ' · anulado'}
                </span>
              </span>
              <span className={`tabular-nums ${r.anulado ? 'line-through' : ''}`}>{formatMXN(r.monto)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
