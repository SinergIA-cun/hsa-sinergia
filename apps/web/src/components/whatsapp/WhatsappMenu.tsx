import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MessageCircle } from 'lucide-react';
import type { EtapaWhatsapp } from '@hsa/shared';
import { enlaceWhatsapp, usePlantillasWhatsapp } from './plantillas.ts';

const ETAPAS_EVENTO: EtapaWhatsapp[] = ['saludo', 'confirmacion', 'recordatorioSaldo', 'ultimoRecibo', 'agradecimiento'];

/**
 * El botón de WhatsApp del evento con un mensaje pre-redactado por etapa
 * (reunión del 15-oct-2026). La persona lo revisa y lo manda desde su WhatsApp:
 * la API oficial se descartó por costo. Los textos los edita el admin.
 */
export function WhatsappMenu({
  telefono,
  vars,
  hayRecibo,
}: {
  telefono: string | null | undefined;
  vars: Record<string, string | null | undefined>;
  hayRecibo: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { texto, data } = usePlantillasWhatsapp();
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-medium tracking-wide text-white shadow-sm transition-colors hover:bg-[#1da851]"
      >
        <MessageCircle size={15} /> WhatsApp <ChevronDown size={14} />
      </button>
      {abierto && (
        <ul className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-cream-300 bg-white py-1 shadow-lg">
          {ETAPAS_EVENTO.filter((e) => e !== 'ultimoRecibo' || hayRecibo).map((e) => (
            <li key={e}>
              <a
                href={enlaceWhatsapp(texto(e), telefono, vars)}
                target="_blank"
                rel="noreferrer"
                onClick={() => setAbierto(false)}
                className="block px-3 py-2 text-sm text-ink hover:bg-cream-100"
              >
                {data?.plantillas[e]?.titulo ?? e}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
