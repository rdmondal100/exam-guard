import { z } from 'zod';

/**
 * Which app this is (M52): the teacher and the student app are built separately from one
 * codebase, so the kind is fixed at build time and never chosen at run time.
 */
export const AppModeSchema = z.enum(['teacher', 'student']);
export type AppMode = z.infer<typeof AppModeSchema>;

/** What the renderer is allowed to know about the app shell. */
export const AppInfoSchema = z.object({
  app: AppModeSchema,
  profile: z.string(),
  version: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;
