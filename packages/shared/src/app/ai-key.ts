import { z } from 'zod';

/**
 * Teacher mode (M43): the AI key goes renderer → main once, is encrypted with `safeStorage` into
 * `secrets.bin` and is never sent back. The renderer only learns whether one is set.
 */
export const AiKeySetRequestSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(10)
    .max(200)
    .regex(/^[\x21-\x7e]+$/, 'The key has no spaces or special characters'),
});
export type AiKeySetRequest = z.infer<typeof AiKeySetRequestSchema>;

/** `stored`: saved in Settings; `env`: only `EG_GEMINI_API_KEY` from the shell (dev). */
export const AiKeyStatusSchema = z.object({
  set: z.boolean(),
  source: z.enum(['stored', 'env']).nullable(),
  /** `safeStorage` works on this PC (it needs a logged-in Windows user). */
  encryptionAvailable: z.boolean(),
});
export type AiKeyStatus = z.infer<typeof AiKeyStatusSchema>;
