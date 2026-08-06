import { REGIMENES_FISCALES, USOS_CFDI } from './catalogos.js';

export interface DatosFiscales {
  rfc?: string | null;
  razonSocial?: string | null;
  regimenFiscal?: string | null;
  cpFiscal?: string | null;
  usoCfdi?: string | null;
  correoFacturacion?: string | null;
}

export interface RequisitoFactura {
  campo: keyof DatosFiscales;
  label: string;
  ok: boolean;
  /** Qué se espera, para mostrarlo cuando falta o está mal. */
  ayuda: string;
}

// Persona moral 12 caracteres, física 13. 3-4 letras (o &/Ñ), fecha AAMMDD, 3 de homoclave.
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
const CP = /^\d{5}$/;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const limpio = (v?: string | null): string => (v ?? '').trim();

/**
 * Qué falta para poder facturarle a este cliente. Fuente única: la consumen el
 * formulario, el contrato y el API del BI, para que las tres digan lo mismo.
 */
export function requisitosFactura(d: DatosFiscales): RequisitoFactura[] {
  const rfc = limpio(d.rfc).toUpperCase();
  const cp = limpio(d.cpFiscal);
  const regimen = limpio(d.regimenFiscal);
  const uso = limpio(d.usoCfdi);
  const correo = limpio(d.correoFacturacion);

  return [
    {
      campo: 'rfc',
      label: 'RFC',
      ok: RFC.test(rfc),
      ayuda: '12 caracteres si es empresa, 13 si es persona física.',
    },
    {
      campo: 'razonSocial',
      label: 'Razón social',
      ok: limpio(d.razonSocial).length > 0,
      ayuda: 'Nombre fiscal exacto, sin el régimen societario (sin "S.A. de C.V.").',
    },
    {
      campo: 'regimenFiscal',
      label: 'Régimen fiscal',
      ok: regimen in REGIMENES_FISCALES,
      ayuda: 'Clave del SAT, viene en la Constancia de Situación Fiscal.',
    },
    {
      campo: 'cpFiscal',
      label: 'Código postal fiscal',
      ok: CP.test(cp),
      ayuda: '5 dígitos del domicilio fiscal, no el del evento.',
    },
    {
      campo: 'usoCfdi',
      label: 'Uso del CFDI',
      ok: uso in USOS_CFDI,
      ayuda: 'Para la renta de un salón suele ser "Gastos en general".',
    },
    {
      campo: 'correoFacturacion',
      label: 'Correo para la factura',
      ok: CORREO.test(correo),
      ayuda: 'Puede ser distinto al correo de contacto.',
    },
  ];
}

/** ¿Falta algo para poder facturar? */
export function faltanDatosFactura(d: DatosFiscales): boolean {
  return requisitosFactura(d).some((r) => !r.ok);
}
