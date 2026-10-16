import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Scale, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { STATUS_LABEL } from '../lib/status.ts';
import type { QuoteStatus } from '../lib/types.ts';

interface Cuenta { total: number; pagado: number; saldo: number }
interface Descuadre {
  quoteId: string;
  codigo: string | null;
  cliente: string;
  fecha: string;
  status: QuoteStatus;
  pasado: boolean;
  renta: Cuenta;
  banquete: Cuenta | null;
  puntoDeVenta: Cuenta | null;
  motivos: string[];
}

/**
 * Los eventos donde lo cobrado no cuadra con lo contratado (reunión del
 * 15-oct-2026). Solo el admin. Se arreglan en el evento (cobrar, corregir o mover
 * un pago, ajustar el estatus) y, ya cuadrado, se cierra.
 */
export function DescuadresPanel() {
  const [abierto, setAbierto] = useState(false);
  const { data } = useQuery({
    queryKey: ['descuadres'],
    queryFn: () => api.get<{ descuadres: Descuadre[] }>('/api/dashboard/descuadres'),
  });
  const lista = data?.descuadres ?? [];
  if (lista.length === 0) return null;
  return (
    <section aria-label="Descuadres" className="mb-6 rounded-xl border border-gold/40 bg-gold/5 p-4">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="inline-flex items-center gap-2 font-display text-lg text-ink">
          <Scale size={18} className="text-gold" />
          {lista.length === 1 ? 'Un evento no cuadra' : `${lista.length} eventos no cuadran`}
          <span className="font-sans text-sm text-charcoal-soft">· lo cobrado contra lo contratado</span>
        </span>
        {abierto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {abierto && (
        <ul className="mt-3 divide-y divide-gold/20">
          {lista.map((d) => (
            <li key={d.quoteId} className="py-2.5 text-sm">
              <Link to={`/eventos/${d.quoteId}`} className="group block">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <strong className="text-ink group-hover:underline">{d.cliente}</strong>
                    <span className="text-charcoal-soft"> · {formatEventDate(d.fecha)} · {d.codigo ?? ''} · {STATUS_LABEL[d.status]}</span>
                  </span>
                  <span className="tabular-nums text-charcoal-soft">
                    Renta {formatMXN(d.renta.pagado)} de {formatMXN(d.renta.total)}
                  </span>
                </span>
                <span className="mt-0.5 block text-wine">{d.motivos.join(' · ')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
