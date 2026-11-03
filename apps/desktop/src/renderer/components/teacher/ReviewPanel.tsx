import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { GradingStatus, Question, ReviewRow, ReviewTable } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';
import type { GradingApi } from '@/api/gradingApi';
import { Button } from '@/components/ui/button';
import {
  STATUS_LABEL,
  STATUS_STYLE,
  attentionFirst,
  isLowConfidence,
  marksText,
} from '@/lib/grading';
import { AnswerReview } from './AnswerReview';
import { DataTable } from './DataTable';
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
        cell: ({ row }) => (row.original.empty ? 'empty' : row.original.language),
      },
      {
        header: 'Marks',
        cell: ({ row }) => marksText(row.original.total, table?.marks ?? 0),
      },
      {
        header: 'Confidence',
        cell: ({ row }) =>
          isLowConfidence(row.original) ? (
            <span className="rounded bg-amber-200 px-2 py-0.5 font-medium text-amber-900">low</span>
          ) : (
            (row.original.confidence ?? '—')
          ),
      },
      {
        header: 'Status',
        cell: ({ row }) => (
          <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[row.original.status]}`}>
            {STATUS_LABEL[row.original.status]}
          </span>
        ),
      },
      {
        header: '',
        id: 'open',
        cell: ({ row }) => (
          <Button
            variant="outline"
            className="h-7 px-2"
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
    <section
      aria-label="Review"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-xl font-semibold">Review</h2>
        {questions.map((q) => {
          const c = status.questions.find((x) => x.questionId === q.id);
          const attention = (c?.needsManual ?? 0) + (c?.lowConfidence ?? 0);
          return (
            <Button
              key={q.id}
              variant={q.id === questionId ? 'default' : 'outline'}
              className="h-8 px-3"
              onClick={() => setQuestionId(q.id)}
            >
              Q{q.position}
              {attention > 0 && <span className="ml-1 text-amber-600">({attention})</span>}
            </Button>
          );
        })}
        {status.examState === 'in_review' && !reevaluating && (
          <Button
            variant="outline"
            className="ml-auto h-8 px-3"
            onClick={() => setReevaluating(true)}
          >
            Re-evaluate Q{question?.position}…
          </Button>
        )}
      </div>
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
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <DataTable
        columns={columns}
        data={rows}
        empty="No final answers for this question."
        maxHeight="max-h-[32rem]"
        rowClassName={(r) =>
          isLowConfidence(r) ? 'bg-amber-50' : r.status === 'needs_manual' ? 'bg-red-50' : ''
        }
      />
    </section>
  );
}
