import type { FormaPago } from '../pagos/formas.js';

// El CFDI 4.0 de un pago, en el JSON que pide la API de Emisión de Facturador.com
// (apidocs.facturador.com → CFDI 4.0 → Factura). Es una factura de ingreso (I)
// pagada en una sola exhibición (PUE) por el monto del pago.
//
// El esquema fiscal definitivo (factura por pago, o PPD + complemento de pagos)
// lo decide el contador; esto es lo que pide la prueba de compatibilidad.

export interface EmisorCfdi {
  rfc: string;
  /** Razón social exacta, sin régimen societario (como en la constancia). */
  nombre: string;
  regimenFiscal: string;
  /** Código postal del lugar de expedición. */
  codigoPostal: string;
}

export interface ReceptorCfdi {
  rfc: string;
  nombre: string;
  regimenFiscal: string;
  codigoPostal: string;
  usoCfdi: string;
}

export interface ConceptoCfdi {
  /** Clave de producto o servicio del SAT. La define el contador. */
  claveProdServ: string;
  /** Clave de unidad del SAT (E48 = unidad de servicio). */
  claveUnidad: string;
  descripcion: string;
}

/** Forma de pago del catálogo c_FormaPago del SAT. */
export const FORMA_PAGO_SAT: Record<FormaPago | 'tarjeta', string> = {
  efectivo: '01',
  cheque: '02',
  transferencia: '03',
  tarjetaCredito: '04',
  tarjetaDebito: '28',
  // Pagos viejos que solo dicen "tarjeta": se tratan como crédito.
  tarjeta: '04',
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** RFC genérico de público en general (Anexo 20). */
export const RFC_PUBLICO_GENERAL = 'XAXX010101000';

/**
 * El receptor de una factura a público en general: RFC genérico, régimen 616
 * (sin obligaciones fiscales), uso S01 y, como domicilio, el lugar de expedición.
 */
export function receptorPublicoGeneral(codigoPostalEmisor: string): ReceptorCfdi {
  return { rfc: RFC_PUBLICO_GENERAL, nombre: 'PUBLICO EN GENERAL', regimenFiscal: '616', codigoPostal: codigoPostalEmisor, usoCfdi: 'S01' };
}

/**
 * El nodo `InformacionGlobal` que el SAT exige con el RFC genérico. Cada pago se
 * factura por separado (regla de Fernando, 16-oct-2026), así que la periodicidad
 * es diaria (`01`) y el mes y el año son los del día en que se timbra.
 */
export function informacionGlobalDiaria(fechaLocal: string): { periodicidad: string; meses: string; año: string } {
  return { periodicidad: '01', meses: fechaLocal.slice(5, 7), año: fechaLocal.slice(0, 4) };
}

/**
 * Lo que se factura de un pago: todo menos el efectivo (16-oct y 30-oct-2026).
 * Un pago mixto solo factura sus partes que no son efectivo.
 */
export function partesFacturables<T extends { forma: string; monto: number }>(partes: readonly T[]): { partes: T[]; monto: number } {
  const facturables = partes.filter((p) => p.forma !== 'efectivo' && p.monto > 0);
  return { partes: facturables, monto: r2(facturables.reduce((s, p) => s + p.monto, 0)) };
}

/**
 * La forma de pago del CFDI. Un pago dividido (débito + crédito) se factura con
 * la forma de la parte más grande, que es la regla del SAT para PUE con varias formas.
 */
export function formaPagoSat(partes: { forma: string; monto: number }[]): string {
  const mayor = [...partes].sort((a, b) => b.monto - a.monto)[0];
  return FORMA_PAGO_SAT[mayor?.forma as FormaPago] ?? '99';
}

/** Parte un monto con IVA incluido en base e IVA, a dos decimales y sin perder centavos. */
export function desglosarIva(montoConIva: number, tasa: number): { base: number; iva: number } {
  const base = r2(montoConIva / (1 + tasa));
  return { base, iva: r2(montoConIva - base) };
}

/**
 * El cuerpo para `POST …/emisores/{emisorId}/comprobantes?emitir=true`.
 * `fecha` va en hora local de México, sin zona (`2026-10-12T10:30:00`).
 */
export function cfdiDePago(args: {
  emisor: EmisorCfdi;
  receptor: ReceptorCfdi;
  concepto: ConceptoCfdi;
  /** Lo que pagó el cliente, con IVA. */
  montoConIva: number;
  partes: { forma: string; monto: number }[];
  fecha: string;
  ivaRate: number;
  /** Facturador la exige. La cuenta de pruebas usa "Sin Serie". */
  serie: string;
  /** El id de la serie en Facturador, si la cuenta tiene varias del mismo nombre. */
  serieId?: number;
  folio?: string;
  /** Solo a público en general: ver `informacionGlobalDiaria`. */
  informacionGlobal?: { periodicidad: string; meses: string; año: string };
}) {
  const { base, iva } = desglosarIva(args.montoConIva, args.ivaRate);
  const traslado = { base, impuesto: '002', tipoFactor: 'Tasa', tasaOCuota: args.ivaRate, importe: iva };
  return {
    version: '4.0',
    serie: args.serie,
    ...(args.serieId != null ? { serieId: args.serieId } : {}),
    ...(args.folio ? { folio: args.folio } : {}),
    fecha: args.fecha,
    tipoDeComprobante: 'I',
    exportacion: '01',
    metodoPago: 'PUE',
    formaPago: formaPagoSat(args.partes),
    moneda: 'MXN',
    lugarExpedicion: args.emisor.codigoPostal,
    subTotal: base,
    total: r2(base + iva),
    emisor: { rfc: args.emisor.rfc, nombre: args.emisor.nombre, regimenFiscal: args.emisor.regimenFiscal },
    receptor: {
      rfc: args.receptor.rfc,
      nombre: args.receptor.nombre,
      usoCFDI: args.receptor.usoCfdi,
      regimenFiscalReceptor: args.receptor.regimenFiscal,
      domicilioFiscalReceptor: args.receptor.codigoPostal,
    },
    conceptos: [
      {
        claveProdServ: args.concepto.claveProdServ,
        cantidad: 1,
        claveUnidad: args.concepto.claveUnidad,
        descripcion: args.concepto.descripcion,
        valorUnitario: base,
        importe: base,
        objetoImp: '02',
        impuestos: { traslados: [traslado] },
      },
    ],
    impuestos: { traslados: [traslado], totalImpuestosTrasladados: iva },
    ...(args.informacionGlobal ? { informacionGlobal: args.informacionGlobal } : {}),
  };
}

export type CfdiPago = ReturnType<typeof cfdiDePago>;
