/** Arma un link de WhatsApp (wa.me) con mensaje prellenado. Devuelve null si el
 *  teléfono no es utilizable. Normaliza a MX: 10 dígitos → antepone 52. */
export function whatsappUrl(telefono: string | null | undefined, mensaje: string): string | null {
  if (!telefono) return null;
  const digits = telefono.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const conLada = digits.length === 10 ? `52${digits}` : digits;
  return `https://wa.me/${conLada}?text=${encodeURIComponent(mensaje)}`;
}

/** Mensaje estándar para enviar una cotización/estado de cuenta al cliente. */
export function mensajeCotizacion(cliente: string, evento: string, url: string): string {
  return `Hola ${cliente}, le comparto su cotización de ${evento} en Hacienda San Andrés: ${url}`;
}

/**
 * Mensaje para mandarle al banquetero su estado de cuenta. Es lo que sustituye al
 * hilo de WhatsApp donde hoy se discute cuánto trae sin repartir.
 */
export function mensajeEstadoCuenta(banquetero: string, url: string): string {
  return `Hola ${banquetero}, aquí puede ver en vivo su estado de cuenta con Hacienda San Andrés: sus eventos, sus depósitos y cómo se repartieron. ${url}`;
}
