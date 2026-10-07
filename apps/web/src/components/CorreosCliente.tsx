import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatTimestamp } from '../lib/date.ts';
import { Card } from './ui.tsx';

interface CorreoCliente {
  id: string;
  tipo: 'bienvenida' | 'recibo' | 'cierre';
  para: string | null;
  estado: 'pendiente' | 'enviado' | 'error' | 'omitido';
  error: string | null;
  enviadoAt: string | null;
  createdAt: string;
}

const TIPO: Record<CorreoCliente['tipo'], string> = {
  bienvenida: 'Confirmación del evento',
  recibo: 'Recibo de pago',
  cierre: 'Agradecimiento y total del evento',
};

const ESTADO: Record<CorreoCliente['estado'], { label: string; clase: string }> = {
  pendiente: { label: 'Por enviar', clase: 'bg-cream-200 text-ink' },
  enviado: { label: 'Enviado', clase: 'bg-emerald-50 text-emerald-700' },
  error: { label: 'Falló, se reintenta', clase: 'bg-wine/10 text-wine' },
  omitido: { label: 'No se mandó', clase: 'bg-ink/5 text-charcoal-soft' },
};

/**
 * Lo que se le mandó al cliente por correo: la confirmación al formalizar, el
 * recibo de cada pago y el agradecimiento a los 2 días hábiles del evento.
 */
export function CorreosCliente({ quoteId, isAdmin }: { quoteId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const key = ['correos', quoteId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ correos: CorreoCliente[]; configurado: boolean }>(`/api/quotes/${quoteId}/correos`),
  });
  const reenviar = useMutation({
    mutationFn: (id: string) => api.post(`/api/quotes/${quoteId}/correos/${id}/reenviar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  if (!data || (data.correos.length === 0 && data.configurado)) return null;

  return (
    <Card className="mt-6 p-6">
      <h3 className="mb-1 flex items-center gap-2 font-display text-xl text-ink">
        <Mail size={18} className="text-gold" /> Correos al cliente
      </h3>
      {!data.configurado && (
        <p className="mb-3 text-sm text-charcoal-soft">
          El correo de salida todavía no está configurado: por ahora no se manda nada.
        </p>
      )}
      {data.correos.length === 0 ? (
        <p className="text-sm text-charcoal-soft">Todavía no hay correos para este evento.</p>
      ) : (
        <ul className="divide-y divide-cream-300">
          {data.correos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <span className="text-ink">{TIPO[c.tipo]}</span>
                <span className="text-charcoal-soft">
                  {c.para && ` · ${c.para}`} · {formatTimestamp(c.enviadoAt ?? c.createdAt)}
                </span>
                {c.error && c.estado !== 'enviado' && <span className="block text-xs text-charcoal-soft">{c.error}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO[c.estado].clase}`}>{ESTADO[c.estado].label}</span>
                {isAdmin && c.estado !== 'pendiente' && (
                  <button
                    type="button"
                    onClick={() => reenviar.mutate(c.id)}
                    disabled={reenviar.isPending}
                    className="inline-flex items-center gap-1 text-xs text-ink hover:underline disabled:opacity-50"
                  >
                    <RotateCcw size={12} /> Reenviar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
