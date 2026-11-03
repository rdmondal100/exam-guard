import { z } from 'zod';

/**
 * Teacher mode (M42): show a results CSV in Explorer. Only a file name: main opens it inside the
 * profile's `exports/` folder and nowhere else.
 */
export const RevealExportRequestSchema = z.object({
  fileName: z
    .string()
    .min(5)
    .max(200)
    .regex(/^[^\\/:*?"<>|]+\.csv$/, 'A CSV file name without a folder')
    .refine((name) => !name.startsWith('..'), 'A CSV file name without a folder'),
});
export type RevealExportRequest = z.infer<typeof RevealExportRequestSchema>;
