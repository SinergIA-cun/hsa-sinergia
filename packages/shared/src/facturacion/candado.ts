/**
 * Candado de facturación, POR PAGO.
 *
 * El SAT exige facturar el ingreso en el mes en que se recibe: un anticipo
 * cobrado en marzo se factura en marzo aunque el evento sea en octubre. Si el
 * mes cierra sin que el cliente pidiera CFDI, ese ingreso entra en la factura
 * global de público en general y ya no se puede timbrar individualmente.
 *
 * Función pura: recibe el "hoy" en vez de leer el reloj, para poder probarla.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export interface PagoParaCandado {
  fecha: Date | string;
  /** Cuándo se timbró el CFDI. Lo llenará el PAC; hoy siempre null. */
  facturadoAt?: Date | string | null;
  /** Un admin reabrió el pago para corregir tras una cancelación. */
  desbloqueoAt?: Date | string | null;
  anuladoAt?: Date | string | null;
}

export interface EstadoFactura {
  facturable: boolean;
  /** Por qué no se puede facturar, en lenguaje para la operación. `null` si sí se puede. */
  motivo: string | null;
}

const aFecha = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/**
 * El día civil de México como fecha a medianoche UTC.
 *
 * Los pagos se guardan como día calendario pinchado a medianoche UTC, así que el
 * "hoy" del candado tiene que estar en ese mismo espacio. Usar `new Date()` a
 * secas haría que el mes cerrara a las 18:00 hora de México del último día.
 * México no aplica horario de verano desde 2022, así que el desfase fijo basta.
 */
const OFFSET_MEXICO_HORAS = -6;

export function hoyCivilMexico(ahora: Date = new Date()): Date {
  const local = new Date(ahora.getTime() + OFFSET_MEXICO_HORAS * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** Primer instante del mes siguiente al de `d`, en UTC. */
function inicioDelMesSiguiente(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export function estadoFacturaPago(pago: PagoParaCandado, hoy: Date): EstadoFactura {
  if (pago.anuladoAt) {
    return { facturable: false, motivo: 'El pago está anulado.' };
  }
  if (pago.facturadoAt) {
    return { facturable: false, motivo: 'Ya se facturó este pago.' };
  }
  if (pago.desbloqueoAt) {
    // Un admin lo reabrió a propósito (típicamente tras cancelar un CFDI).
    return { facturable: true, motivo: null };
  }
  const fecha = aFecha(pago.fecha);
  if (hoy < inicioDelMesSiguiente(fecha)) {
    return { facturable: true, motivo: null };
  }
  const mes = MESES[fecha.getUTCMonth()];
  return {
    facturable: false,
    motivo: `Cerró ${mes} sin CFDI: este pago se facturó a público en general.`,
  };
}

export interface EstadoEdicionFiscal {
  editable: boolean;
  motivo: string | null;
}

/**
 * ¿Se pueden todavía tocar los datos fiscales del cliente?
 *
 * Se congelan en cuanto existe UNA factura emitida con ellos: el CFDI ya salió
 * con ese RFC y esa razón social, y cambiarlos por debajo desalinea lo timbrado.
 * Un admin sí puede moverlos (el rol se verifica en la API, no aquí).
 *
 * El corte de mes NO congela: un pago que se fue a la factura global dejó de ser
 * facturable, pero nunca llevó los datos del cliente a ningún CFDI.
 *
 * No recibe `hoy` a propósito: esta regla no depende del calendario.
 */
export function datosFiscalesEditables(pagos: PagoParaCandado[]): EstadoEdicionFiscal {
  const facturado = pagos.some((p) => !p.anuladoAt && p.facturadoAt);
  if (!facturado) return { editable: true, motivo: null };
  return {
    editable: false,
    motivo: 'Ya se emitió una factura con estos datos. Solo un administrador puede cambiarlos.',
  };
}
