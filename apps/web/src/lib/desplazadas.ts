import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import type { Desplazada } from './types.ts';

/** Llave compartida: el panel y la agenda leen el MISMO caché de empalmes. */
export const DESPLAZADAS_KEY = ['quotes', 'desplazadas'] as const;

/**
 * Cotizaciones del usuario que perdieron su fecha porque otra la apartó.
 *
 * Derivado en el servidor y sin estado de "leído": el aviso desaparece solo
 * cuando alguien mueve la fecha o cancela la cotización.
 */
export function useDesplazadas() {
  return useQuery({
    queryKey: DESPLAZADAS_KEY,
    queryFn: () => api.get<{ items: Desplazada[] }>('/api/quotes/desplazadas'),
  });
}
