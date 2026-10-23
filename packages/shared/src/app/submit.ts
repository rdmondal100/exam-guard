import { z } from 'zod';

/**
 * What `submitExam()` resolves with. The receipt itself reaches the renderer on `session:exam`
 * (`state.receipt`), the same way it does after a restart.
 */
export const SubmitOutcomeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type SubmitOutcome = z.infer<typeof SubmitOutcomeSchema>;
