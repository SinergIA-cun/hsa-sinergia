/**
 * Un cliente sin teléfono ni correo es un cliente al que no se le puede avisar
 * nada: ni que se le vence un pago, ni que cambió su evento. El dueño lo pidió
 * así: **al menos uno de los dos es obligatorio**.
 *
 * Vive en `shared` porque la API lo exige y el formulario lo enseña, y las dos
 * reglas tienen que ser la misma: un formulario que deja guardar algo que la API
 * rechaza es peor que no validar.
 */

/** Dígitos mínimos para que un teléfono cuente (fijo local de 8, celular de 10). */
export const TELEFONO_MIN_DIGITOS = 8;

export const MENSAJE_SIN_CONTACTO = 'El cliente necesita al menos un teléfono o un correo.';

/** Un teléfono cuenta si trae al menos 8 dígitos; espacios, guiones y lada no estorban. */
export function telefonoValido(telefono: string | null | undefined): boolean {
  return (telefono ?? '').replace(/\D/g, '').length >= TELEFONO_MIN_DIGITOS;
}

/** Forma de correo: algo, arroba, dominio con punto. La API además lo valida con zod. */
export function correoValido(correo: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((correo ?? '').trim());
}

export function tieneContacto(c: { telefono?: string | null; correo?: string | null }): boolean {
  return telefonoValido(c.telefono) || correoValido(c.correo);
}
