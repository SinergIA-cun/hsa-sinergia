import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Paperclip, RotateCcw, Send, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatTimestamp } from '../lib/date.ts';
import { apiErrorMessage } from './admin/shared.tsx';
import { Button, Card, Field, TextInput } from './ui.tsx';

interface CorreoCliente {
  id: string;
  tipo: 'bienvenida' | 'recibo' | 'cierre' | 'liquidacion';
  para: string | null;
  estado: 'pendiente' | 'enviado' | 'error' | 'omitido';
  error: string | null;
  enviadoAt: string | null;
  createdAt: string;
}

interface VistaCorreo {
  para: string | null;
  asunto: string | null;
  texto: string | null;
  adjuntos: string[];
  motivo: string | null;
}

const TIPO: Record<CorreoCliente['tipo'], string> = {
  bienvenida: 'Confirmación del evento',
  recibo: 'Recibo de pago',
  cierre: 'Agradecimiento y total del evento',
  liquidacion: 'Recordatorio de liquidación (30 días antes)',
};

const ESTADO: Record<CorreoCliente['estado'], { label: string; clase: string }> = {
  pendiente: { label: 'Listo para mandar', clase: 'bg-gold/15 text-ink' },
  enviado: { label: 'Enviado', clase: 'bg-emerald-50 text-emerald-700' },
  error: { label: 'Falló al mandar', clase: 'bg-wine/10 text-wine' },
  omitido: { label: 'No se mandó', clase: 'bg-ink/5 text-charcoal-soft' },
};

const porMandar = (c: CorreoCliente) => c.estado === 'pendiente' || c.estado === 'error';

/**
 * Los correos al cliente: la confirmación al formalizar, el recibo de cada pago,
 * el recordatorio de liquidación y el agradecimiento después del evento.
 *
 * Son MANUALES (21-oct-2026): se preparan solos, pero no salen hasta que alguien
 * los revisa aquí —puede cambiar el destinatario, el asunto y el texto— y
 * presiona Enviar. "Enviar los pendientes" los manda tal cual, de una vez.
 */
export function CorreosCliente({ quoteId, isAdmin }: { quoteId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const key = ['correos', quoteId];
  const [abierto, setAbierto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ correos: CorreoCliente[]; configurado: boolean }>(`/api/quotes/${quoteId}/correos`),
  });
  const refrescar = () => qc.invalidateQueries({ queryKey: key });
  const reenviar = useMutation({
    mutationFn: (id: string) => api.post(`/api/quotes/${quoteId}/correos/${id}/reenviar`),
    onSuccess: refrescar,
  });
  const descartar = useMutation({
    mutationFn: (id: string) => api.post(`/api/quotes/${quoteId}/correos/${id}/descartar`),
    onSuccess: refrescar,
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo descartar.')),
  });
  const todos = useMutation({
    mutationFn: async (ids: string[]) => {
      const fallas: string[] = [];
      for (const id of ids) {
        try {
          await api.post(`/api/quotes/${quoteId}/correos/${id}/enviar`, {});
        } catch (e) {
          fallas.push(apiErrorMessage(e, 'No se pudo mandar.'));
        }
      }
      if (fallas.length) throw new Error(fallas.join(' '));
    },
    onSettled: refrescar,
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudieron mandar todos.'),
  });
  if (!data || (data.correos.length === 0 && data.configurado)) return null;

  const pendientes = data.correos.filter(porMandar);

  return (
    <Card className="mt-6 p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-xl text-ink">
          <Mail size={18} className="text-gold" /> Correos al cliente
        </h3>
        {data.configurado && pendientes.length > 1 && (
          <Button
            variant="gold"
            className="px-3 py-1.5 text-sm"
            disabled={todos.isPending}
            onClick={() => {
              setError('');
              todos.mutate(pendientes.map((c) => c.id));
            }}
          >
            <Send size={14} /> {todos.isPending ? 'Mandando…' : `Enviar los ${pendientes.length} pendientes`}
          </Button>
        )}
      </div>
      <p className="mb-3 text-sm text-charcoal-soft">
        {data.configurado
          ? 'No salen solos: revísalos y presiona Enviar. Puedes cambiar el texto antes de mandarlo.'
          : 'El correo de salida todavía no está configurado: por ahora no se puede mandar nada.'}
      </p>
      {error && <p className="mb-3 rounded-lg bg-wine/10 px-3 py-2 text-sm text-wine">{error}</p>}
      {data.correos.length === 0 ? (
        <p className="text-sm text-charcoal-soft">Todavía no hay correos para este evento.</p>
      ) : (
        <ul className="divide-y divide-cream-300">
          {data.correos.map((c) => (
            <li key={c.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="text-ink">{TIPO[c.tipo]}</span>
                  <span className="text-charcoal-soft">
                    {c.para && ` · ${c.para}`} · {formatTimestamp(c.enviadoAt ?? c.createdAt)}
                  </span>
                  {c.error && <span className="block text-xs text-charcoal-soft">{c.error}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO[c.estado].clase}`}>{ESTADO[c.estado].label}</span>
                  {porMandar(c) && data.configurado && abierto !== c.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setError('');
                        setAbierto(c.id);
                      }}
                      className="inline-flex items-center gap-1 rounded text-xs font-medium text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
                    >
                      <Send size={12} /> Revisar y enviar
                    </button>
                  )}
                  {porMandar(c) && (
                    <button
                      type="button"
                      onClick={() => descartar.mutate(c.id)}
                      disabled={descartar.isPending}
                      className="inline-flex items-center gap-1 text-xs text-charcoal-soft hover:text-wine hover:underline disabled:opacity-50"
                    >
                      <X size={12} /> Descartar
                    </button>
                  )}
                  {isAdmin && !porMandar(c) && (
                    <button
                      type="button"
                      onClick={() => reenviar.mutate(c.id)}
                      disabled={reenviar.isPending}
                      className="inline-flex items-center gap-1 text-xs text-ink hover:underline disabled:opacity-50"
                    >
                      <RotateCcw size={12} /> {c.estado === 'enviado' ? 'Volver a preparar' : 'Preparar de nuevo'}
                    </button>
                  )}
                </span>
              </div>
              {abierto === c.id && (
                <EditorCorreo
                  quoteId={quoteId}
                  correoId={c.id}
                  onCerrar={() => setAbierto(null)}
                  onEnviado={async () => {
                    setAbierto(null);
                    await refrescar();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** El correo tal como va a salir, con para, asunto y texto editables. */
function EditorCorreo({
  quoteId,
  correoId,
  onCerrar,
  onEnviado,
}: {
  quoteId: string;
  correoId: string;
  onCerrar: () => void;
  onEnviado: () => Promise<void>;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['correo-vista', correoId],
    queryFn: () => api.get<{ vista: VistaCorreo }>(`/api/quotes/${quoteId}/correos/${correoId}/vista`),
    staleTime: 0,
  });
  const vista = data?.vista;
  const [para, setPara] = useState<string | null>(null);
  const [asunto, setAsunto] = useState<string | null>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const enviar = useMutation({
    mutationFn: () =>
      api.post(`/api/quotes/${quoteId}/correos/${correoId}/enviar`, {
        para: para ?? vista?.para ?? undefined,
        asunto: asunto ?? vista?.asunto ?? undefined,
        texto: texto ?? vista?.texto ?? undefined,
      }),
    onSuccess: onEnviado,
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo mandar.')),
  });

  if (isLoading || !vista) return <p className="mt-3 text-sm text-charcoal-soft">Preparando el correo…</p>;
  if (vista.motivo) {
    return (
      <p className="mt-3 rounded-lg bg-cream-200/70 px-3 py-2 text-sm text-ink">
        No hay nada que mandar: {vista.motivo}{' '}
        <button type="button" onClick={onCerrar} className="underline">
          Cerrar
        </button>
      </p>
    );
  }
  const textoActual = texto ?? vista.texto ?? '';
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-gold/40 bg-gold/5 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Para">
          <TextInput type="email" value={para ?? vista.para ?? ''} onChange={(e) => setPara(e.target.value)} />
        </Field>
        <Field label="Asunto">
          <TextInput value={asunto ?? vista.asunto ?? ''} onChange={(e) => setAsunto(e.target.value)} />
        </Field>
      </div>
      <Field label="Mensaje" hint="Si no lo cambias, sale con el diseño de siempre (con sus tablas). Si lo editas, sale este texto con el encabezado de la hacienda.">
        <textarea
          value={textoActual}
          onChange={(e) => setTexto(e.target.value)}
          rows={12}
          className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-sans text-sm leading-relaxed text-charcoal focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
        />
      </Field>
      {vista.adjuntos.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-charcoal-soft">
          <Paperclip size={12} /> {vista.adjuntos.join(', ')}
        </p>
      )}
      {error && <p className="text-sm text-wine">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="gold" disabled={enviar.isPending || textoActual.trim() === ''} onClick={() => enviar.mutate()}>
          <Send size={14} /> {enviar.isPending ? 'Mandando…' : 'Enviar'}
        </Button>
        <Button variant="outline" onClick={onCerrar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
