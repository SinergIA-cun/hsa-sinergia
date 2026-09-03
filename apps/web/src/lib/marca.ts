/**
 * La identidad del salón de eventos: cómo se llama y con qué razón social firma.
 *
 * Existe por el demo de ventas. La app se le enseña a OTROS salones —la
 * competencia de Hacienda San Andrés— y una demo con su nombre en el encabezado
 * y su razón social en las nueve páginas del contrato es enseñarles cosas que no
 * les tocan.
 *
 * Por omisión es Hacienda San Andrés, así que la instalación del cliente no
 * cambia en nada. La instancia de demo define las tres variables en su servicio
 * web y con eso cambia toda la app, el recibo y el contrato.
 *
 * LO QUE ESTO **NO** CAMBIA: el TEXTO de las cláusulas del contrato sigue siendo
 * el de Hacienda San Andrés —sus porcentajes de cancelación, sus reglas de
 * responsabilidad—. Cambia quién firma, no lo que se firma. Si el demo va a
 * enseñar el contrato a detalle, hay que escribir cláusulas neutras; para
 * enseñar que "el sistema imprime tu contrato ya llenado", esto alcanza.
 */
export const MARCA = {
  /** El nombre que se lee en el encabezado, el recibo y el contrato. */
  nombre: import.meta.env.VITE_MARCA_NOMBRE || 'Hacienda San Andrés',
  /** El año bajo el logo. Vacío lo esconde. */
  anio: import.meta.env.VITE_MARCA_ANIO ?? '1894',
  /** Con quién se firma el contrato: la razón social completa. */
  razonSocial: import.meta.env.VITE_MARCA_RAZON_SOCIAL || 'Hacienda San Andrés Atoto, S.A.',
  /** Domicilio completo: recibo, contrato y las vistas públicas. */
  direccion:
    import.meta.env.VITE_MARCA_DIRECCION ||
    'Atlacomulco No. 1, Col. San Esteban, Naucalpan de Juárez, Estado de México',
  /** El mismo, recortado para el pie del login. */
  direccionCorta:
    import.meta.env.VITE_MARCA_DIRECCION_CORTA || 'Atlacomulco No. 1, Naucalpan, Estado de México',
  telefono: import.meta.env.VITE_MARCA_TELEFONO || '5357 1986',
  sitio: import.meta.env.VITE_MARCA_SITIO || 'www.haciendasanandres.com.mx',
  /** Solo para los ejemplos de los campos de correo. */
  dominioCorreo: import.meta.env.VITE_MARCA_DOMINIO_CORREO || 'haciendasanandres.com.mx',
} as const;
