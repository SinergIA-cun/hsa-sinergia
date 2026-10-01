import { z } from 'zod';

/**
 * Notas libres de un pago: "cualquier cosa que ayude a entender el pago" (el
 * dueño). Internas: no salen en la página del cliente ni en su recibo.
 */
export const NOTAS_MAX = 1000;
export const notasSchema = z.string().max(NOTAS_MAX, `Las notas van hasta ${NOTAS_MAX} caracteres.`);

/** Lo vacío se guarda como `null`: una nota en blanco no es una nota. */
export const notaONull = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

export const editarNotasSchema = z.object({ notas: notasSchema.nullable() });
