import { useState } from 'react';
import type { Question } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { GradingView } from '@/hooks/useGrading';
import { JOB_STATE_LABEL, gradingAction, jobProgress } from '@/lib/grading';

interface Props {
  examId: string;
  grading: GradingView;
  questions: readonly Question[];
  /** The exam state changed (Grading / In review): reload the exam list. */
  onStateChange: () => void;
}

/**
 * "Evaluate with AI" and its progress (M38): one bar per question, graded question by question,
 * pushed live over the teacher socket. Answers the AI could not grade are counted as failed and
 * wait for the teacher in the review below.
 */
export function GradingPanel({ examId, grading, questions, onStateChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { api, status } = grading;
  if (!status) return null;
  const action = gradingAction(status);
  const jobs = new Map(status.jobs.map((j) => [j.questionId, j]));

  const run = async () => {
    if (!api || !action) return;
    if (
      action.kind === 'stop' &&
      !window.confirm('Stop grading? Answers not graded yet stay pending.')
    ) {
      return;
    }
    setBusy(true);
    try {
      grading.set(action.kind === 'stop' ? await api.cancel(examId) : await api.start(examId));
      setNotice(null);
      onStateChange();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="AI grading"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">AI grading</h2>
        {status.provider === 'fake' && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            Dev fake grader: marks are not real
          </span>
        )}
        {action && (
          <Button
            className="ml-auto"
            variant={action.kind === 'stop' ? 'outline' : 'default'}
            disabled={busy || !api}
            onClick={() => void run()}
          >
            {action.label}
          </Button>
        )}
      </div>
      {(notice ?? grading.error) && (
        <p role="alert" className="text-sm text-red-700">
          {notice ?? grading.error}
        </p>
      )}
      {status.examState === 'ended' && (
        <p className="text-sm text-muted">
          Each question is graded for all students with the same instructions. Only an anonymous id
          is sent, never a name or student ID.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {status.questions.map((q) => {
          const job = jobs.get(q.questionId);
          const title = questions.find((x) => x.id === q.questionId)?.body.split('\n')[0] ?? '';
          return (
            <li key={q.questionId} className="flex flex-col gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Q{q.position}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{title}</span>
                <span>
                  {q.aiGraded + q.verified + q.modified} of {q.answers} graded
                  {q.needsManual > 0 && ` · ${q.needsManual} need manual grading`}
                  {q.lowConfidence > 0 && ` · ${q.lowConfidence} low confidence`}
                </span>
                {job && <span className="text-muted">({JOB_STATE_LABEL[job.state]})</span>}
              </div>
              {job && (job.state === 'running' || job.state === 'queued') && (
                <div
                  role="progressbar"
                  aria-label={`Question ${q.position} progress`}
                  aria-valuemin={0}
                  aria-valuemax={job.total}
                  aria-valuenow={job.done + job.failed}
                  className="h-2 overflow-hidden rounded bg-slate-200"
                >
                  <div
                    className="h-full bg-sky-600 transition-all"
                    style={{ width: `${Math.round(jobProgress(job) * 100)}%` }}
                  />
                </div>
              )}
              {job?.state === 'failed' && job.error && <p className="text-red-700">{job.error}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
