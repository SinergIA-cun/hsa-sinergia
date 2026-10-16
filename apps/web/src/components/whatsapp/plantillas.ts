import { useQuery } from '@tanstack/react-query';
import { PLANTILLAS_WHATSAPP, rellenarPlantilla, type EtapaWhatsapp } from '@hsa/shared';
import { api } from '../../lib/api.ts';
import { MARCA } from '../../lib/marca.ts';
import { whatsappUrl } from '../../lib/share.ts';

export interface Plantilla {
  titulo: string;
  texto: string;
  porDefecto: string;
  editada: boolean;
}

/** Los textos vigentes (los del admin, o los de arranque mientras carga). */
export function usePlantillasWhatsapp() {
  const q = useQuery({
    queryKey: ['whatsapp-plantillas'],
    queryFn: () => api.get<{ plantillas: Record<EtapaWhatsapp, Plantilla> }>('/api/whatsapp/plantillas'),
    staleTime: 5 * 60_000,
  });
  const texto = (etapa: EtapaWhatsapp) => q.data?.plantillas[etapa]?.texto ?? PLANTILLAS_WHATSAPP[etapa].texto;
  return { ...q, texto };
}

/** El enlace de WhatsApp con la plantilla rellena. Sin teléfono usable, abre WhatsApp para elegir contacto. */
export function enlaceWhatsapp(texto: string, telefono: string | null | undefined, vars: Record<string, string | null | undefined>) {
  const mensaje = rellenarPlantilla(texto, { marca: MARCA.nombre, ...vars });
  return whatsappUrl(telefono, mensaje) ?? `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
}
