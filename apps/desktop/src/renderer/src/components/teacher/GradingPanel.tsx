import { useState } from 'react';
import { SparklesIcon, SquareIcon } from 'lucide-react';
import type { Question } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { GradingView } from '@/hooks/useGrading';
import { useConfirm } from '@/hooks/useConfirm';
import { JOB_STATE_LABEL, gradingAction, jobProgress } from '@/lib/grading';
import { ErrorAlert } from '../common/ErrorAlert';

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
  const confirm = useConfirm();
  const { api, status } = grading;
  if (!status) return null;
  const action = gradingAction(status);
  const jobs = new Map(status.jobs.map((j) => [j.questionId, j]));

  const run = async () => {
    if (!api || !action) return;
    if (
      action.kind === 'stop' &&
      !(await confirm({
        title: 'Stop grading?',
        description: 'Answers not graded yet stay pending.',
        confirmLabel: 'Stop grading',
        destructive: true,
      }))
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
    <Card aria-label="AI grading">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          <SparklesIcon className="size-4 text-primary" aria-hidden />
          AI grading
          {status.provider === 'fake' && (
            <Badge variant="warning">Dev fake grader: marks are not real</Badge>
          )}
        </CardTitle>
        {status.examState === 'ended' && (
          <CardDescription>
            Each question is graded for all students with the same instructions. Only an anonymous
            id is sent, never a name or student ID.
          </CardDescription>
        )}
        {action && (
          <CardAction>
            <Button
              variant={action.kind === 'stop' ? 'outline' : 'default'}
              disabled={busy || !api}
              onClick={() => void run()}
            >
              {action.kind === 'stop' ? <SquareIcon /> : <SparklesIcon />}
              {action.label}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {(notice ?? grading.error) && <ErrorAlert>{notice ?? grading.error}</ErrorAlert>}
        <ul className="flex flex-col divide-y rounded-lg border">
          {status.questions.map((q) => {
            const job = jobs.get(q.questionId);
            const title = questions.find((x) => x.id === q.questionId)?.body.split('\n')[0] ?? '';
            return (
              <li key={q.questionId} className="flex flex-col gap-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">Q{q.position}</Badge>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{title}</span>
                  <span className="font-medium">
                    {q.aiGraded + q.verified + q.modified} of {q.answers} graded
                  </span>
                  {q.needsManual > 0 && (
                    <Badge variant="danger">{q.needsManual} need manual grading</Badge>
                  )}
                  {q.lowConfidence > 0 && (
                    <Badge variant="warning">{q.lowConfidence} low confidence</Badge>
                  )}
                  {job && (
                    <span className="text-muted-foreground">
                      ({job.kind === 'reevaluate' && 'Re-evaluation: '}
                      {JOB_STATE_LABEL[job.state]})
                    </span>
                  )}
                </div>
                {job && (job.state === 'running' || job.state === 'queued') && (
                  <Progress
                    aria-label={`Question ${q.position} progress`}
                    value={Math.round(jobProgress(job) * 100)}
                    getValueLabel={() => `${job.done + job.failed} of ${job.total}`}
                  />
                )}
                {job?.state === 'failed' && job.error && (
                  <p className="text-destructive">{job.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
