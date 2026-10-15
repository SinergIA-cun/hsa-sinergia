import { MessageCircle } from 'lucide-react';
import { formatFolio } from '@hsa/shared';
import { formatMXN } from '../lib/money.ts';
import { mensajeRecibo, whatsappUrl } from '../lib/share.ts';

export interface ClienteContacto {
  nombre: string;
  telefono: string | null;
}

/**
 * Botón chico junto a un recibo: abre WhatsApp con el mensaje y el enlace al
 * recibo de ESE pago. Si el cliente no tiene un teléfono usable, WhatsApp abre
 * sin destinatario y la vendedora elige el contacto.
 */
export function ReciboWhatsApp({
  cliente,
  publicToken,
  pago,
}: {
  cliente: ClienteContacto | null | undefined;
  publicToken: string;
  pago: { id: string; folio: number; folioLetra?: string | null; monto: number };
}) {
  const url = `${window.location.origin}/c/${publicToken}/recibo/${pago.id}`;
  const folio = formatFolio(pago.folio, pago.folioLetra);
  const mensaje = mensajeRecibo(cliente?.nombre ?? 'cliente', folio, formatMXN(pago.monto), url);
  const href = whatsappUrl(cliente?.telefono, mensaje) ?? `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
  const conTelefono = !!whatsappUrl(cliente?.telefono, mensaje);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Mandar el recibo ${folio} por WhatsApp`}
      title={conTelefono ? 'Mandar el recibo por WhatsApp' : 'El cliente no tiene teléfono: elige el contacto en WhatsApp'}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
    >
      <MessageCircle size={13} /> WhatsApp
    </a>
  );
}
