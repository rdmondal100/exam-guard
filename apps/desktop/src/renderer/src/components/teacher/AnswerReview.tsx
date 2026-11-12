import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { AnswerDetail, GradingStatus, Question } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';
import type { GradingApi } from '@/api/gradingApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { draftBody, type GradeDraft } from '@/lib/grading';
import { LANGUAGE_LABEL } from '@/lib/languages';
import { formatDuration } from '@/lib/eventsView';
import { ErrorAlert } from '../common/ErrorAlert';
import { LoadingLine } from '../common/Spinner';
import { AnswerTimeline } from './AnswerTimeline';
import { GradeEditor } from './GradeEditor';
import { GradeHistory } from './GradeHistory';
import { GradeStatusBadge } from './GradeStatusBadge';
import { ReevaluateForm } from './ReevaluateForm';

const ReadOnlyCode = lazy(() => import('./ReadOnlyCode'));

interface Props {
  examId: string;
  examApi: ExamApi;
  api: GradingApi;
  question: Question;
  examStudentId: string;
  /** Changes when grading moves on: the answer reloads (a re-evaluation landed). */
  version: string;
  /** A re-evaluation of this answer started (M41). */
  onGrading: (status: GradingStatus) => void;
  /** A grade changed: the table reloads. */
  onChanged: () => void;
  onClose: () => void;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}

const LABELS: Record<string, string> = { ...LANGUAGE_LABEL, text: 'Text' };
const label = (language: string) => LABELS[language] ?? language;

/**
 * One answer (M39): the student's answer in the language they used beside the sample answer,
 * the grade per criterion, feedback and line notes (marked in the code), the grading history and
 * the student's event timeline. In review the teacher accepts or edits it (M40).
 */
export function AnswerReview(props: Props) {
  const { examId, examApi, api, question, examStudentId, onChanged, version } = props;
  const [detail, setDetail] = useState<AnswerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reevaluating, setReevaluating] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api.answer(examStudentId, question.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, examStudentId, question.id]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const change = async (action: () => Promise<AnswerDetail>) => {
    setBusy(true);
    try {
      setDetail(await action());
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const notes = detail?.current?.teacherNotes ?? [];
  const low = detail?.grade.status === 'ai_graded' && detail.grade.confidence === 'low';

  return (
    <Card aria-label="Answer review">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          Q{question.position} · {detail ? detail.student.name : '…'}
          {detail && <GradeStatusBadge status={detail.grade.status} />}
        </CardTitle>
        {detail && (
          <CardDescription>
            <span className="font-mono">{detail.student.studentCode}</span> · risk{' '}
            {detail.student.riskScore} · outside{' '}
            {detail.student.outsideMs > 0 ? formatDuration(detail.student.outsideMs) : 'none'}
          </CardDescription>
        )}
        <CardAction className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!props.onPrev} onClick={props.onPrev}>
            <ChevronLeftIcon />
            Previous
          </Button>
          <Button size="sm" variant="outline" disabled={!props.onNext} onClick={props.onNext}>
            Next
            <ChevronRightIcon />
          </Button>
          <Button size="sm" onClick={props.onClose}>
            <ArrowLeftIcon />
            Back to the list
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {low && (
          <Alert role="status" variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>
              The AI was not sure about this grade (low confidence). Check it before accepting.
            </AlertDescription>
          </Alert>
        )}
        {detail?.examState === 'grading' && (
          <p role="status" className="text-sm text-muted-foreground">
            Grading is running; marks can be changed again when it finishes.
          </p>
        )}
        {detail?.examState === 'in_review' &&
          (reevaluating ? (
            <ReevaluateForm
              api={api}
              examId={examId}
              questionId={question.id}
              examStudentId={examStudentId}
              edited={detail.grade.status === 'verified' || detail.grade.status === 'modified'}
              onStarted={props.onGrading}
              onClose={() => setReevaluating(false)}
            />
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setReevaluating(true)}
            >
              <RefreshCcwIcon />
              Re-evaluate this answer…
            </Button>
          ))}
        {detail && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  Student answer ({label(detail.answer.language)})
                </h3>
                {detail.answer.content.trim() === '' ? (
                  <p className="text-sm text-muted-foreground">
                    The student left this answer empty.
                  </p>
                ) : (
                  <Suspense fallback={<LoadingLine>Loading…</LoadingLine>}>
                    <ReadOnlyCode
                      value={detail.answer.content}
                      language={detail.answer.language}
                      notes={notes}
                    />
                  </Suspense>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  Sample answer ({label(question.sampleLanguage)})
                </h3>
                <Suspense fallback={<LoadingLine>Loading…</LoadingLine>}>
                  <ReadOnlyCode value={question.sampleAnswer} language={question.sampleLanguage} />
                </Suspense>
              </div>
            </div>
            {notes.length > 0 && (
              <section
                aria-label="Line notes"
                className="rounded-lg border bg-warning/5 p-3 text-sm"
              >
                <h3 className="mb-1 font-semibold">Line notes</h3>
                <ul className="list-disc pl-5">
                  {notes.map((n) => (
                    <li key={`${n.line}-${n.issue}`}>
                      <span className="font-mono">line {n.line}</span>: {n.issue}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                <GradeEditor
                  key={detail.grade.currentEvaluationId ?? 'none'}
                  detail={detail}
                  question={question}
                  editable={detail.examState === 'in_review'}
                  busy={busy}
                  onAccept={() => void change(() => api.accept(examStudentId, question.id))}
                  onSave={(draft: GradeDraft) =>
                    void change(() => api.edit(examStudentId, question.id, draftBody(draft)))
                  }
                />
                <section aria-label="History" className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">History</h3>
                  <GradeHistory
                    history={detail.history}
                    currentId={detail.grade.currentEvaluationId}
                    max={question.marks}
                  />
                </section>
              </div>
              <AnswerTimeline examId={examId} api={examApi} examStudentId={examStudentId} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
