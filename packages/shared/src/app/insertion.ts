import { z } from 'zod';
import { PASTE_PREVIEW_CHARS, PasteSurfaceSchema } from './clipboard.js';

/**
 * Large text insertion (M27): a burst of typed text over these limits that was not an allowed
 * paste is flagged. A burst is a run of key presses each within `INSERTION_BURST_GAP_MS` of the
 * one before (by the keyboard event's own time stamp): no person types that fast for long, while
 * AutoHotkey, `SendKeys` and typing tools do. Key auto-repeat is about 33 ms per key at most.
 */
export const LARGE_INSERTION_CHARS = 200;
/** New lines in one burst that are flagged, whatever the length. */
export const LARGE_INSERTION_LINES = 5;
export const INSERTION_BURST_GAP_MS = 25;

/**
 * Renderer → main (`insertion:large`): a large insertion seen in an editor or answer box. Main
 * turns it into a `large_insertion` event, at most one per 2 s; `suppressed` counts the reports
 * folded into it. `lines` = line breaks inserted; `durationMs` = first to last key of the burst.
 */
export const LargeInsertionReportSchema = z.object({
  surface: PasteSurfaceSchema,
  chars: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  preview: z.string().max(PASTE_PREVIEW_CHARS),
  suppressed: z.number().int().nonnegative().optional(),
});
export type LargeInsertionReport = z.infer<typeof LargeInsertionReportSchema>;
