import { z } from 'zod';

/**
 * The lobby readiness check (M54): while students wait, each PC compiles and runs a tiny program
 * in every language and checks its free disk space, so the teacher sees broken PCs before Start.
 */
export const READINESS_CHECKS = ['c', 'cpp', 'python', 'js', 'disk'] as const;
export const ReadinessCheckNameSchema = z.enum(READINESS_CHECKS);
export type ReadinessCheckName = z.infer<typeof ReadinessCheckNameSchema>;

/** The labels students and teachers see. */
export const READINESS_LABEL: Record<ReadinessCheckName, string> = {
  c: 'C',
  cpp: 'C++',
  python: 'Python',
  js: 'JavaScript',
  disk: 'Disk space',
};

export const ReadinessCheckSchema = z.object({
  name: ReadinessCheckNameSchema,
  ok: z.boolean(),
  ms: z.number().int().nonnegative(),
  /** Why it failed, shown to the student and the teacher. */
  message: z.string().max(300).optional(),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

/** Every check exactly once (M60): a partial report must never show a PC as ready. */
export const ReadinessReportSchema = z.object({
  checks: z
    .array(ReadinessCheckSchema)
    .length(READINESS_CHECKS.length)
    .refine((checks) => new Set(checks.map((c) => c.name)).size === READINESS_CHECKS.length, {
      message: 'Each check must appear exactly once',
    }),
});
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;

/** Student → server: sent after the check and again after every welcome. */
export const ReadinessReportMessageSchema = ReadinessReportSchema.extend({
  t: z.literal('readiness.report'),
});
export type ReadinessReportMessage = z.infer<typeof ReadinessReportMessageSchema>;

/** What the roster shows: no report yet, all passed, or something failed. */
export const ReadinessStateSchema = z.enum(['pending', 'ok', 'problem']);
export type ReadinessState = z.infer<typeof ReadinessStateSchema>;

/** The failed checks, as "C++: g++ not found". */
export function readinessProblems(report: ReadinessReport): string[] {
  return report.checks
    .filter((c) => !c.ok)
    .map((c) => `${READINESS_LABEL[c.name]}${c.message ? `: ${c.message}` : ''}`);
}
