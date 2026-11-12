import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardCheckIcon, RefreshCcwIcon } from 'lucide-react';
import type { GradingStatus, Question, ReviewRow, ReviewTable } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';
import type { GradingApi } from '@/api/gradingApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { attentionFirst, isLowConfidence, marksText } from '@/lib/grading';
import { ErrorAlert } from '../common/ErrorAlert';
import { AnswerReview } from './AnswerReview';
import { DataTable } from './DataTable';
import { GradeStatusBadge } from './GradeStatusBadge';
import { ReevaluateForm } from './ReevaluateForm';

interface Props {
  examId: string;
  examApi: ExamApi;
  api: GradingApi;
  status: GradingStatus;
  questions: readonly Question[];
  /** A re-evaluation started (M41): show its status. */
  onGrading: (status: GradingStatus) => void;
}

/**
 * The review (M39): per question, a table of every student's answer with the AI total,
 * confidence and status, low confidence highlighted and what needs attention first. A row opens
 * the answer beside the sample, with the grade, the history and the student's timeline. In
 * review the question can be re-evaluated with an instruction (M41).
 */
export function ReviewPanel({ examId, examApi, api, status, questions, onGrading }: Props) {
  const [questionId, setQuestionId] = useState(questions[0]?.id ?? '');
  const [table, setTable] = useState<ReviewTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reevaluating, setReevaluating] = useState(false);
  const question = questions.find((q) => q.id === questionId);
  // Reload whenever grading moves on (counts or a job's progress), so new grades show up.
  const counts = status.questions.find((q) => q.questionId === questionId);
  const job = status.jobs.find((j) => j.questionId === questionId);
  const countsKey = JSON.stringify([counts ?? null, job ?? null, status.examState]);

  const load = useCallback(async () => {
    if (!questionId) return;
    try {
      setTable(await api.reviewTable(examId, questionId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, examId, questionId]);

  useEffect(() => {
    void load();
  }, [load, countsKey]);

  const rows = useMemo(() => attentionFirst(table?.rows ?? []), [table]);
  const columns = useMemo<ColumnDef<ReviewRow>[]>(
    () => [
      { header: 'Student ID', accessorKey: 'studentCode' },
      { header: 'Name', accessorKey: 'name' },
      {
        header: 'Language',
        cell: ({ row }) =>
          row.original.empty ? (
            <span className="text-muted-foreground">empty</span>
          ) : (
            <Badge variant="outline" className="font-mono">
              {row.original.language}
            </Badge>
          ),
      },
      {
        header: 'Marks',
        cell: ({ row }) => (
          <span className="font-medium">{marksText(row.original.total, table?.marks ?? 0)}</span>
        ),
      },
      {
        header: 'Confidence',
        cell: ({ row }) =>
          isLowConfidence(row.original) ? (
            <Badge variant="warning">low</Badge>
          ) : (
            (row.original.confidence ?? '—')
          ),
      },
      {
        header: 'Status',
        cell: ({ row }) => <GradeStatusBadge status={row.original.status} />,
      },
      {
        header: '',
        id: 'open',
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => setOpen(row.original.examStudentId)}
          >
            Open
          </Button>
        ),
      },
    ],
    [table?.marks],
  );

  if (open && question) {
    const index = rows.findIndex((r) => r.examStudentId === open);
    return (
      <AnswerReview
        key={`${open}-${questionId}`}
        examId={examId}
        examApi={examApi}
        api={api}
        question={question}
        examStudentId={open}
        version={countsKey}
        onGrading={onGrading}
        onChanged={() => void load()}
        onClose={() => setOpen(null)}
        onPrev={index > 0 ? () => setOpen(rows[index - 1]?.examStudentId ?? null) : undefined}
        onNext={
          index >= 0 && index < rows.length - 1
            ? () => setOpen(rows[index + 1]?.examStudentId ?? null)
            : undefined
        }
      />
    );
  }

  return (
    <Card aria-label="Review">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <ClipboardCheckIcon className="size-4 text-muted-foreground" aria-hidden />
          Review
        </CardTitle>
        {status.examState === 'in_review' && !reevaluating && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setReevaluating(true)}>
              <RefreshCcwIcon />
              Re-evaluate Q{question?.position}…
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={questionId} onValueChange={setQuestionId}>
          <TabsList aria-label="Question" className="h-auto flex-wrap justify-start">
            {questions.map((q) => {
              const c = status.questions.find((x) => x.questionId === q.id);
              const attention = (c?.needsManual ?? 0) + (c?.lowConfidence ?? 0);
              return (
                <TabsTrigger key={q.id} value={q.id} className="flex-none">
                  Q{q.position}
                  {attention > 0 && (
                    <Badge variant="warning" className="px-1.5 py-0">
                      {attention}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        {reevaluating && status.examState === 'in_review' && (
          <ReevaluateForm
            key={questionId}
            api={api}
            examId={examId}
            questionId={questionId}
            onStarted={onGrading}
            onClose={() => setReevaluating(false)}
          />
        )}
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <DataTable
          columns={columns}
          data={rows}
          empty="No final answers for this question."
          maxHeight="max-h-[32rem]"
          rowClassName={(r) =>
            isLowConfidence(r)
              ? 'bg-warning/8 hover:bg-warning/12'
              : r.status === 'needs_manual'
                ? 'bg-destructive/6 hover:bg-destructive/10'
                : ''
          }
        />
      </CardContent>
    </Card>
  );
}
