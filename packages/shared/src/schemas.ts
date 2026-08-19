import { z } from 'zod';

/**
 * Servicio suelto de UN evento, fuera del catálogo. Ej.: el proveedor de comida
 * cobra $200 más por persona por cambio de menú, solo para este evento.
 *
 * NO es un add-on del catálogo, y es importante que no lo sea: vive en la
 * cotización, así que no puede cambiar de precio bajo sus pies cuando alguien
 * edita el catálogo. Por eso lleva el nombre y el monto copiados, no un id.
 *
 * El monto SIEMPRE trae IVA incluido (decisión del dueño): lo teclado es lo final.
 */
export const quoteExtraSchema = z.object({
  nombre: z.string().min(1).max(120),
  kind: z.enum(['fijo', 'porPersona', 'porUnidad']),
  /** Entero: Postgres trunca los flotantes en columnas `Int` sin avisar. */
  monto: z.number().int().nonnegative(),
  /** Solo se usa en `porUnidad`; `fijo` y `porPersona` la ignoran. */
  cantidad: z.number().int().positive().default(1),
});

export type QuoteExtra = z.infer<typeof quoteExtraSchema>;

export const quoteSelectionSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invitados: z.number().int().positive(),
  spaceIds: z
    .array(z.string())
    .min(1)
    .max(3, { message: 'Máximo 3 espacios por evento' })
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'spaceIds no debe tener duplicados',
    }),
  horasExtra: z.number().int().min(0).default(0),
  usaCapilla: z.boolean().default(false),
  usaDjHoraExtra: z.boolean().default(false),
  // Tipo de evento: necesario para el precio del DJ por hora extra. Opcional en el
  // motor puro; la API/UI siempre lo envían (y lo exigen en su propio esquema).
  eventTypeId: z.string().optional(),
  foodPackageId: z.string().optional(),
  addOns: z
    .array(
      z.object({
        addOnId: z.string(),
        cantidad: z.number().int().positive().default(1),
      }),
    )
    .default([])
    .refine((arr) => new Set(arr.map((a) => a.addOnId)).size === arr.length, {
      message: 'addOnId no debe repetirse',
    }),
  /** Servicios sueltos de ESTE evento (ver `quoteExtraSchema`). */
  extras: z.array(quoteExtraSchema).default([]),
  /**
   * Descuento de cortesía, en por ciento (0..100). Pega SOLO sobre la renta de
   * espacios, la MISMA base que el descuento del 5% por alimentos, y no se
   * compone con él (decisión del dueño + regla de la cabecera del motor).
   */
  descuentoPct: z.number().min(0).max(100).optional(),
  /** Motivo del descuento. Obligatorio si hay descuento: sin él no es auditable. */
  descuentoMotivo: z.string().min(1).max(300).optional(),
});

/**
 * "Si hay descuento, tiene que haber motivo": un descuento de cientos de miles
 * sin explicación es un problema de auditoría, no un campo opcional.
 *
 * Va como refinamiento suelto y NO pegado a `quoteSelectionSchema` porque la API
 * lo extiende con `.extend()`, y `.refine()` devuelve un ZodEffects que ya no
 * tiene ese método. Los esquemas de crear/editar lo aplican al final.
 */
export const motivoObligatorio = {
  check: (d: { descuentoPct?: number | null; descuentoMotivo?: string | null }): boolean =>
    !(d.descuentoPct != null && d.descuentoPct > 0) || Boolean(d.descuentoMotivo?.trim()),
  opts: { message: 'Un descuento de cortesía requiere motivo', path: ['descuentoMotivo'] },
};

/** Tipo derivado del esquema (salida post-parse): fuente única de verdad. */
export type QuoteSelection = z.infer<typeof quoteSelectionSchema>;
