import { z } from 'zod';

export const AppModeSchema = z.enum(['teacher', 'student']);
export type AppMode = z.infer<typeof AppModeSchema>;

/** `dev` = no installer key found (developer machine); nothing is locked. */
export const InstallTypeSchema = z.enum(['teacher', 'student', 'dev']);
export type InstallType = z.infer<typeof InstallTypeSchema>;

/** What the renderer is allowed to know about the app shell. */
export const AppInfoSchema = z.object({
  mode: AppModeSchema.nullable(),
  installType: InstallTypeSchema,
  allowedModes: z.array(AppModeSchema).min(1),
  profile: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const SetModeRequestSchema = z.object({ mode: AppModeSchema });
export type SetModeRequest = z.infer<typeof SetModeRequestSchema>;

/** Modes a given install type may use. A student install is locked to Student mode. */
export function allowedModesFor(installType: InstallType): AppMode[] {
  return installType === 'student' ? ['student'] : ['teacher', 'student'];
}
