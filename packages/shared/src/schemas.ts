import { z } from 'zod';

export const quoteSelectionSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invitados: z.number().int().positive(),
  spaceIds: z.array(z.string()).min(1),
  horasExtra: z.number().int().min(0).default(0),
  foodPackageId: z.string().optional(),
  addOns: z
    .array(z.object({ addOnId: z.string(), cantidad: z.number().int().positive() }))
    .default([]),
});
