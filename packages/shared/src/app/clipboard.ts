import { z } from 'zod';

/** Longest piece of a blocked paste the teacher sees (M25). */
export const PASTE_PREVIEW_CHARS = 200;

/** Where in the exam window the paste was tried. */
export const PASTE_SURFACES = ['editor', 'answer', 'terminal', 'other'] as const;
export const PasteSurfaceSchema = z.enum(PASTE_SURFACES);
export type PasteSurface = z.infer<typeof PasteSurfaceSchema>;

/**
 * Renderer → main (`clipboard:paste-blocked`): the student pasted text that was not copied inside
 * the exam, and the paste was blocked. Main turns it into a `paste_blocked` event, at most one per
 * 2 s; `suppressed` counts the blocks folded into it.
 */
export const PasteBlockedReportSchema = z.object({
  surface: PasteSurfaceSchema,
  chars: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  preview: z.string().max(PASTE_PREVIEW_CHARS),
  suppressed: z.number().int().nonnegative().optional(),
});
export type PasteBlockedReport = z.infer<typeof PasteBlockedReportSchema>;
