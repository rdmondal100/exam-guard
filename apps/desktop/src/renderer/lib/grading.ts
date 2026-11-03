import type {
  AnswerDetail,
  AnswerEditBody,
  AnswerGradeStatus,
  Criterion,
  GradingJob,
  GradingStatus,
  ReviewRow,
} from '@examguard/shared';

export const STATUS_LABEL: Record<AnswerGradeStatus, string> = {
  pending: 'Pending',
  ai_graded: 'AI graded',
  verified: 'Verified',
  modified: 'Modified',
  needs_manual: 'Needs manual grading',
};

export const STATUS_STYLE: Record<AnswerGradeStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  ai_graded: 'bg-sky-100 text-sky-800',
  verified: 'bg-green-100 text-green-800',
  modified: 'bg-violet-100 text-violet-800',
  needs_manual: 'bg-red-100 text-red-800',
};

export const JOB_STATE_LABEL: Record<GradingJob['state'], string> = {
  queued: 'Waiting',
  running: 'Grading',
  done: 'Done',
  failed: 'Stopped with an error',
  cancelled: 'Stopped',
};

/** The one grading button the panel shows, if any. */
export type GradingAction = { kind: 'start' | 'stop'; label: string } | null;

export function gradingAction(status: GradingStatus): GradingAction {
  if (status.examState === 'ended') return { kind: 'start', label: 'Evaluate with AI' };
  if (status.examState === 'grading') return { kind: 'stop', label: 'Stop grading' };
  if (status.examState !== 'in_review') return null;
  const left = status.questions.some((q) => q.pending + q.needsManual > 0);
  return left ? { kind: 'start', label: 'Grade the rest with AI' } : null;
}

/** 0..1: how far a job got (graded or given up on). */
export function jobProgress(job: GradingJob): number {
  return job.total === 0 ? 1 : Math.min(1, (job.done + job.failed) / job.total);
}

/** The AI graded it but was not sure: the teacher should look first. */
export function isLowConfidence(row: Pick<ReviewRow, 'status' | 'confidence'>): boolean {
  return row.status === 'ai_graded' && row.confidence === 'low';
}

const ATTENTION: Record<AnswerGradeStatus, number> = {
  needs_manual: 0,
  pending: 2,
  ai_graded: 3,
  modified: 4,
  verified: 5,
};

/** Needs manual grading first, then low confidence, then the rest; by student code within. */
export function attentionFirst(rows: readonly ReviewRow[]): ReviewRow[] {
  const rank = (r: ReviewRow) => (isLowConfidence(r) ? 1 : ATTENTION[r.status]);
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) || a.studentCode.localeCompare(b.studentCode, undefined, { numeric: true }),
  );
}

/** The teacher's grade form (M40): one row per criterion of the guide, marks as typed. */
export interface GradeDraft {
  criteria: { name: string; max: number; awarded: string; reason: string }[];
  feedback: string;
}

/** Starts from the current grade (AI or teacher), or zeros when there is none. */
export function draftFrom(detail: AnswerDetail, guide: readonly Criterion[]): GradeDraft {
  const current = detail.current;
  return {
    criteria: guide.map((g) => {
      const c = current?.criteria.find((x) => x.name === g.name);
      return {
        name: g.name,
        max: g.maxMarks,
        awarded: c ? String(c.awarded) : '0',
        reason: c?.reason ?? '',
      };
    }),
    feedback: current?.feedback ?? '',
  };
}

/** What is wrong with the typed marks, one sentence per criterion. */
export function draftProblems(draft: GradeDraft): string[] {
  const problems: string[] = [];
  for (const c of draft.criteria) {
    const n = Number(c.awarded);
    if (c.awarded.trim() === '' || !Number.isFinite(n)) problems.push(`${c.name}: enter a number.`);
    else if (n < 0 || n > c.max) problems.push(`${c.name}: between 0 and ${c.max}.`);
    else if (!Number.isInteger(n * 2)) problems.push(`${c.name}: steps of 0.5.`);
  }
  return problems;
}

export function draftTotal(draft: GradeDraft): number {
  return draft.criteria.reduce((sum, c) => sum + (Number(c.awarded) || 0), 0);
}

export function draftBody(draft: GradeDraft): AnswerEditBody {
  return {
    criteria: draft.criteria.map((c) => ({
      name: c.name,
      awarded: Number(c.awarded),
      reason: c.reason,
    })),
    feedback: draft.feedback,
  };
}

/** Marks as text: `7.5 / 8`, or a dash without a grade. */
export function marksText(total: number | null, max: number): string {
  return total === null ? `— / ${max}` : `${total} / ${max}`;
}

/** What stops the teacher from finalizing (M42): answers still without a grade. */
export function finalizeBlockers(status: GradingStatus): { pending: number; needsManual: number } {
  return status.questions.reduce(
    (sum, q) => ({
      pending: sum.pending + q.pending,
      needsManual: sum.needsManual + q.needsManual,
    }),
    { pending: 0, needsManual: 0 },
  );
}
