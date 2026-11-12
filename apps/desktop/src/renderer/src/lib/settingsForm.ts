import { RunLimitsSchema, type RunLimits } from '@examguard/shared';

/** The run-limit fields as the teacher types them: seconds and KB. */
export interface RunLimitsDraft {
  timeSec: string;
  outputKb: string;
}

export function limitsDraft(limits: RunLimits): RunLimitsDraft {
  return {
    timeSec: String(limits.timeMs / 1000),
    outputKb: String(Math.round(limits.outputBytes / 1024)),
  };
}

const LABEL: Record<keyof RunLimits, string> = {
  timeMs: 'Time limit: 5 to 3600 seconds',
  outputBytes: 'Output: 4 to 4096 KB',
};

/** The limits in API units, or one sentence per field that is out of range. */
export function limitsFromDraft(
  draft: RunLimitsDraft,
): { ok: true; limits: RunLimits } | { ok: false; problems: string[] } {
  const n = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
  const parsed = RunLimitsSchema.safeParse({
    timeMs: Math.round(n(draft.timeSec) * 1000),
    outputBytes: Math.round(n(draft.outputKb) * 1024),
  });
  if (parsed.success) return { ok: true, limits: parsed.data };
  const fields = new Set(parsed.error.issues.map((i) => i.path[0] as keyof RunLimits));
  return { ok: false, problems: [...fields].map((f) => LABEL[f]) };
}
