import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import type { StudentAnswer, StudentAnswersResponse } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ExamApi } from '@/api/examApi';
import {
  LIVE_ANSWERS_REFRESH_MS,
  answeredText,
  answersSourceText,
  refreshesLive,
} from '@/lib/studentAnswers';
import { clockTime } from '@/lib/terminalLog';
import { ErrorAlert } from '../common/ErrorAlert';
import { LoadingLine } from '../common/Spinner';
import { GradeStatusBadge } from './GradeStatusBadge';

const ReadOnlyCode = lazy(() => import('./ReadOnlyCode'));

interface Props {
  examId: string;
  student: { id: string; name: string; studentCode: string };
  api: ExamApi;
  /** While the exam runs, an unsubmitted sheet follows the student's autosaves. */
  examRunning: boolean;
  onClose: () => void;
}

/**
 * One student's whole answer sheet (M65): every question with the answer that counts. Once the
 * student is submitted these are the final answers with the receipt and any grade; before that the
 * newest autosave of each answer, refreshed while the exam runs. Read-only.
 */
export function StudentAnswersDialog({ examId, student, api, examRunning, onClose }: Props) {
  const [sheet, setSheet] = useState<StudentAnswersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .studentAnswers(examId, student.id)
      .then((next) => {
        setSheet(next);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, examId, student.id]);
  useEffect(load, [load]);

  const live = refreshesLive(sheet, examRunning);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(load, LIVE_ANSWERS_REFRESH_MS);
    return () => clearInterval(id);
  }, [live, load]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-label={`Answers of ${student.name}`}
        aria-describedby={undefined}
        className="flex h-[calc(100vh-4rem)] max-h-[56rem] flex-col sm:max-w-5xl"
      >
        <DialogHeader className="gap-1 pr-8">
          <div className="flex items-center gap-3">
            <DialogTitle>
              Answers · {student.name}{' '}
              <span className="font-mono font-normal text-muted-foreground">
                {student.studentCode}
              </span>
            </DialogTitle>
            <Button size="sm" variant="outline" className="ml-auto" onClick={load}>
              <RefreshCwIcon />
              Refresh
            </Button>
          </div>
          {sheet && (
            <p className="text-sm text-muted-foreground">
              {answersSourceText(sheet, examRunning)} {answeredText(sheet)}.
            </p>
          )}
        </DialogHeader>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {!sheet && !error && <LoadingLine>Loading answers…</LoadingLine>}
        {sheet && (
          <ol aria-label="Answers" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {sheet.answers.length === 0 && (
              <li className="text-sm text-muted-foreground">This exam has no questions.</li>
            )}
            {sheet.answers.map((a) => (
              <AnswerCard key={a.questionId} answer={a} />
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AnswerCard({ answer: a }: { answer: StudentAnswer }) {
  const marks = `${a.maxMarks} ${a.maxMarks === 1 ? 'mark' : 'marks'}`;
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Question {a.position}</h3>
        <Badge variant="secondary">{marks}</Badge>
        {a.language && <Badge variant="outline">{a.language}</Badge>}
        {a.grade && (
          <>
            <GradeStatusBadge status={a.grade.status} />
            {a.grade.total !== null && (
              <span className="text-sm font-medium">
                {a.grade.total} / {a.maxMarks}
              </span>
            )}
          </>
        )}
        {a.savedAt !== null && (
          <span className="ml-auto text-xs text-muted-foreground">
            saved {clockTime(a.savedAt)}
          </span>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">Question text</summary>
        <p className="pt-1 text-sm whitespace-pre-wrap">{a.body}</p>
      </details>
      {!a.answered ? (
        <p className="text-sm text-muted-foreground italic">No answer.</p>
      ) : a.type === 'code' && a.language && a.language !== 'text' ? (
        <Suspense fallback={<LoadingLine>Loading code…</LoadingLine>}>
          <ReadOnlyCode value={a.content} language={a.language} height="280px" />
        </Suspense>
      ) : (
        <pre className="max-h-72 overflow-auto rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">
          {a.content}
        </pre>
      )}
    </li>
  );
}
