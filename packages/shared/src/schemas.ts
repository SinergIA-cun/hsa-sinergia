import { z } from 'zod';

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
});

/** Tipo derivado del esquema (salida post-parse): fuente única de verdad. */
export type QuoteSelection = z.infer<typeof quoteSelectionSchema>;
