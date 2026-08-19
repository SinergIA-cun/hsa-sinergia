import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';
import type { EstadoCuentaBanquetero, EstadoCuentaPublico } from './types.ts';

/**
 * Llaves de query compartidas de la cuenta corriente del banquetero.
 *
 * Viven aquí y no como literales sueltos en cada componente por la misma razón
 * que `PRICE_LISTS_KEY` en `catalogos.ts`: la ficha, la lista de admin, el
 * tablero y la agenda leen y ensucian los MISMOS datos, y dos llaves parecidas
 * escritas en dos archivos distintos se convierten en una pantalla que miente
 * hasta que alguien recarga. Ya pasó en este repo.
 */
export const ADMIN_BANQUETEROS_KEY = ['admin-banqueteros'] as const;
export const BANQUETEROS_VENTAS_KEY = ['admin-banqueteros-ventas'] as const;
/** El desplegable del cotizador (solo activos). */
export const BANQUETEROS_KEY = ['banqueteros'] as const;
/** El resumen de la cuenta de todos: saldo sin asignar y apartados por vencer. */
export const RESUMEN_BANQUETEROS_KEY = ['banqueteros-resumen'] as const;

export const estadoCuentaKey = (id: string) => ['banquetero-estado-cuenta', id] as const;
export const publicoKey = (token: string) => ['banquetero-publico', token] as const;

/** El estado de cuenta interno: eventos, depósitos, apartados y el saldo sin asignar. */
export function useEstadoCuentaBanquetero(id: string) {
  return useQuery({
    queryKey: estadoCuentaKey(id),
    queryFn: () => api.get<EstadoCuentaBanquetero>(`/api/banqueteros/${id}/estado-cuenta`),
  });
}

/** El mismo estado de cuenta por el enlace de solo lectura, sin sesión. */
export function useEstadoCuentaPublico(token: string) {
  return useQuery({
    queryKey: publicoKey(token),
    queryFn: () => api.get<EstadoCuentaPublico>(`/api/b/${token}`),
    retry: false,
  });
}

/**
 * Lo que hay que refrescar después de CUALQUIER movimiento de la cuenta:
 * registrar un depósito, repartirlo, anular una asignación, apartar o cancelar.
 *
 * Un reparto de $323,345 en tres eventos cambia siete cosas a la vez: el saldo
 * sin asignar del depósito, los pagos y el estatus de las TRES cotizaciones, el
 * estado de cuenta del banquetero, la lista de admin y el tablero. Invalidar
 * solo el estado de cuenta deja el contrato de cada evento mostrando el saldo
 * viejo, que es exactamente el bug que ya se cometió aquí con el catálogo.
 *
 * - `['quote']` por PREFIJO: alcanza a `['quote', <id>]` de los tres eventos sin
 *   tener que saber cuáles fueron.
 * - `['agenda']` porque un apartado pinta fecha, y `['availability']` porque la
 *   bloquea en el selector de espacios.
 */
export function useInvalidarBanquetero(id: string) {
  const qc = useQueryClient();
  return async function invalidar(): Promise<void> {
    await Promise.all([
      qc.invalidateQueries({ queryKey: estadoCuentaKey(id) }),
      qc.invalidateQueries({ queryKey: ADMIN_BANQUETEROS_KEY }),
      qc.invalidateQueries({ queryKey: BANQUETEROS_VENTAS_KEY }),
      qc.invalidateQueries({ queryKey: RESUMEN_BANQUETEROS_KEY }),
      qc.invalidateQueries({ queryKey: ['quote'] }),
      qc.invalidateQueries({ queryKey: ['quotes'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['agenda'] }),
      qc.invalidateQueries({ queryKey: ['availability'] }),
    ]);
  };
}
