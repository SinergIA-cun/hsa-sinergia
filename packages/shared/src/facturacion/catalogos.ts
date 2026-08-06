/**
 * Claves del SAT para CFDI 4.0.
 *
 * Van en código, no en una tabla editable por el admin: son claves oficiales
 * que cambian cada varios años, no configuración del negocio. Si el SAT publica
 * una clave nueva que la hacienda necesite, se agrega aquí.
 *
 * Es un subconjunto curado, no el catálogo completo: solo los regímenes y usos
 * que aparecen al facturar la renta de un salón de eventos.
 */

export const REGIMENES_FISCALES: Record<string, string> = {
  '601': 'General de Ley Personas Morales',
  '603': 'Personas Morales con Fines no Lucrativos',
  '605': 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
  '606': 'Arrendamiento',
  '608': 'Demás ingresos',
  '612': 'Personas Físicas con Actividades Empresariales y Profesionales',
  '616': 'Sin obligaciones fiscales',
  '621': 'Incorporación Fiscal',
  '626': 'Régimen Simplificado de Confianza',
};

export const USOS_CFDI: Record<string, string> = {
  G01: 'Adquisición de mercancías',
  G02: 'Devoluciones, descuentos o bonificaciones',
  G03: 'Gastos en general',
  CP01: 'Pagos',
  S01: 'Sin efectos fiscales',
};

/** El uso habitual al facturar un evento. */
export const USO_CFDI_SUGERIDO = 'G03';
