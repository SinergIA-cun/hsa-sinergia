import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, ArrowLeft, MessageCircle } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { Button, Card, TextInput, ArrowDivider } from '../components/ui.tsx';
import { QuoteForm, type QuotePayload } from '../components/QuoteForm.tsx';
import { whatsappUrl, mensajeCotizacion } from '../lib/share.ts';
import type { Catalog, Quote } from '../lib/types.ts';

export function NewQuotePage() {
  const { data: catalog, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<Catalog>('/api/catalog'),
  });

  const [saved, setSaved] = useState<Quote | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(payload: QuotePayload) {
    setError('');
    try {
      const res = await api.post<{ quote: Quote }>('/api/quotes', payload);
      setSaved(res.quote);
    } catch {
      setError('No se pudo guardar. Revisa los datos.');
    }
  }

  const publicUrl = saved ? `${window.location.origin}/c/${saved.publicToken}` : '';

  if (isLoading) return <p className="text-charcoal-soft">Cargando catálogo…</p>;
  if (!catalog) return <p className="text-wine">No se pudo cargar el catálogo.</p>;

  if (saved) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-gold/15 text-gold">
          <Check size={28} />
        </div>
        <ArrowDivider>Cotización creada</ArrowDivider>
        <h1 className="mt-3 font-display text-4xl text-ink">{formatMXN(saved.total)}</h1>
        <p className="mt-1 text-sm text-charcoal-soft">
          Comparte el link o el código QR con tu cliente. Podrá ver la cotización y su estado de
          cuenta en vivo.
        </p>
        <Card className="mt-8 p-8">
          <div className="mx-auto w-fit rounded-xl bg-white p-4 shadow-sm">
            <QRCodeSVG value={publicUrl} size={168} fgColor="#14304d" bgColor="#ffffff" />
          </div>
          <div className="mt-6 flex items-center gap-2">
            <TextInput readOnly value={publicUrl} className="text-center text-xs" />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(publicUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>
        </Card>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {(() => {
            const wa = whatsappUrl(
              saved.client?.telefono,
              mensajeCotizacion(saved.client?.nombre ?? 'cliente', saved.eventType?.nombre ?? 'evento', publicUrl),
            );
            return wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-medium tracking-wide text-white shadow-sm transition-colors hover:bg-[#1da851]"
              >
                <MessageCircle size={16} /> Enviar por WhatsApp
              </a>
            ) : null;
          })()}
          <a href={publicUrl} target="_blank" rel="noreferrer">
            <Button variant="gold">Ver como cliente</Button>
          </a>
          <Link to="/cotizaciones">
            <Button variant="outline">Ir a cotizaciones</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/cotizaciones"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal-soft hover:text-ink"
      >
        <ArrowLeft size={15} /> Cotizaciones
      </Link>
      <ArrowDivider>Nueva</ArrowDivider>
      <h1 className="mb-8 mt-2 font-display text-4xl text-ink">Armar cotización</h1>
      <QuoteForm
        catalog={catalog}
        submitLabel="Guardar y generar link"
        onSubmit={handleSubmit}
        errorMsg={error}
        enableClientSearch
      />
    </div>
  );
}
