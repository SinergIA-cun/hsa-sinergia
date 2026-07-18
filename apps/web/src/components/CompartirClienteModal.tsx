import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, X, MessageCircle, ExternalLink } from 'lucide-react';
import { Button, TextInput } from './ui.tsx';
import { whatsappUrl, mensajeCotizacion } from '../lib/share.ts';
import type { Quote } from '../lib/types.ts';

interface Props {
  quote: Quote;
  publicUrl: string;
  onClose: () => void;
}

/**
 * QR + enlace del contrato para compartir con el cliente, en un diálogo: nunca
 * saca al usuario del contrato.
 */
export function CompartirClienteModal({ quote, publicUrl, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const wa = whatsappUrl(
    quote.client?.telefono,
    mensajeCotizacion(quote.client?.nombre ?? 'cliente', quote.eventType?.nombre ?? 'evento', publicUrl),
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compartir contrato con el cliente"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-[var(--radius-card)] bg-cream p-8 shadow-xl"
      >
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-charcoal-soft transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <X size={18} />
        </button>

        <h2 className="font-display text-2xl text-ink">QR / enlace cliente</h2>
        <p className="mt-1 text-sm text-charcoal-soft">
          El cliente verá su contrato y su estado de cuenta en vivo.
        </p>

        <div className="mx-auto mt-6 w-fit rounded-xl bg-white p-4 shadow-sm">
          <QRCodeSVG value={publicUrl} size={168} fgColor="#14304d" bgColor="#ffffff" />
        </div>

        <div className="mt-6 flex items-center gap-2">
          <TextInput readOnly value={publicUrl} className="text-center text-xs" />
          <Button
            variant="outline"
            aria-label="Copiar enlace"
            onClick={() => {
              void navigator.clipboard.writeText(publicUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </Button>
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-medium tracking-wide text-white shadow-sm transition-colors hover:bg-[#1da851]"
            >
              <MessageCircle size={16} /> Enviar por WhatsApp
            </a>
          )}
          <a href={publicUrl} target="_blank" rel="noreferrer">
            <Button variant="outline">
              <ExternalLink size={15} /> Ver como cliente
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
