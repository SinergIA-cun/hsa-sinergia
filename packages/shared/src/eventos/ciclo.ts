/**
 * El ciclo de un evento fuera del camino normal: cancelarlo, ponerlo en standby
 * (sin fecha) y reprogramarlo.
 *
 * Los dos estatus nuevos SUELTAN la fecha: no ocupan la agenda ni bloquean la
 * disponibilidad, y los pagos que entren no los hacen subir de estatus. Viven en
 * `shared` porque la API filtra con ellos y la web los pinta.
 */

/** Estatus que sueltan la fecha del evento. */
export const ESTATUS_SIN_FECHA = ['standby', 'cancelada'] as const;
export type EstatusSinFecha = (typeof ESTATUS_SIN_FECHA)[number];

export function sueltaLaFecha(status: string): status is EstatusSinFecha {
  return (ESTATUS_SIN_FECHA as readonly string[]).includes(status);
}

/** Atajos que ofrece la pantalla al cancelar; cualquier otro porcentaje vale. */
export const PORCENTAJES_DEVOLUCION = [100, 50, 0] as const;

export interface Cancelacion {
  /** Lo pagado (neto) a la renta del evento el día que se canceló. */
  pagado: number;
  /** Porcentaje de lo pagado que se le devuelve. */
  porcentaje: number;
  /** Lo que se acordó devolver. */
  devolver: number;
  /** Lo que la hacienda se queda. */
  retenido: number;
}

/**
 * Lo que se devuelve y lo que se retiene al cancelar. Se redondea al peso, y lo
 * retenido es siempre el complemento exacto: devolver + retenido = pagado.
 */
export function calcularCancelacion(pagado: number, porcentaje: number): Cancelacion {
  if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) {
    throw new Error('El porcentaje a devolver va de 0 a 100.');
  }
  const base = Math.max(0, Math.round(pagado));
  const devolver = Math.round((base * porcentaje) / 100);
  return { pagado: base, porcentaje, devolver, retenido: base - devolver };
}

/**
 * Lo que falta devolver de una cancelación: lo acordado menos lo ya devuelto
 * después de cancelar. Nunca negativo (si se devolvió de más, falta cero).
 */
export function pendientePorDevolver(devolver: number, devueltoDespues: number): number {
  return Math.max(0, devolver - devueltoDespues);
}
