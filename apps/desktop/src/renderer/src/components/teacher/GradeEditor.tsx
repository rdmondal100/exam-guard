import { useState } from 'react';
import { CheckIcon, PencilIcon } from 'lucide-react';
import type { AnswerDetail, Question } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { draftFrom, draftProblems, draftTotal, type GradeDraft } from '@/lib/grading';
import { ErrorAlert } from '../common/ErrorAlert';

interface Props {
  detail: AnswerDetail;
  question: Question;
  /** In review only: before that grading runs, after it the marks are locked. */
  editable: boolean;
  busy: boolean;
  onAccept: () => void;
  onSave: (draft: GradeDraft) => void;
}

/**
 * The grade per criterion with its reason, and the feedback (M39); in review the teacher accepts
 * the AI grade or changes marks and feedback (M40). A mark can't go over the criterion's max.
 */
export function GradeEditor({ detail, question, editable, busy, onAccept, onSave }: Props) {
  const [draft, setDraft] = useState<GradeDraft>(() => draftFrom(detail, question.criteria));
  const [editing, setEditing] = useState(false);
  const problems = draftProblems(draft);
  const current = detail.current;
  const canAccept = editable && detail.grade.status === 'ai_graded';

  const setCriterion = (i: number, patch: Partial<GradeDraft['criteria'][number]>) =>
    setDraft((d) => ({
      ...d,
      criteria: d.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    }));

  return (
    <section aria-label="Grade" className="flex flex-col gap-3">
      <div className="rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-3">Criterion</TableHead>
              <TableHead className="px-3">Marks</TableHead>
              <TableHead className="px-3">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.criteria.map((c, i) => (
              <TableRow key={c.name} className="align-top hover:bg-transparent">
                <TableCell className="px-3 py-2 font-medium whitespace-normal">{c.name}</TableCell>
                <TableCell className="px-3 py-2 whitespace-nowrap">
                  {editing ? (
                    <Input
                      aria-label={`Marks for ${c.name}`}
                      type="number"
                      min={0}
                      max={c.max}
                      step={0.5}
                      className="inline-flex h-8 w-20"
                      value={c.awarded}
                      onChange={(e) => setCriterion(i, { awarded: e.target.value })}
                    />
                  ) : (
                    c.awarded
                  )}{' '}
                  / {c.max}
                </TableCell>
                <TableCell className="px-3 py-2 whitespace-normal">
                  {editing ? (
                    <Input
                      aria-label={`Reason for ${c.name}`}
                      className="h-8"
                      value={c.reason}
                      onChange={(e) => setCriterion(i, { reason: e.target.value })}
                    />
                  ) : (
                    c.reason || <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/30 font-semibold hover:bg-muted/30">
              <TableCell className="px-3 py-2">Total</TableCell>
              <TableCell className="px-3 py-2" colSpan={2}>
                {current || editing
                  ? `${draftTotal(draft)} / ${question.marks}`
                  : `— / ${question.marks}`}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">Feedback for the student</span>
        {editing ? (
          <Textarea
            className="min-h-24"
            value={draft.feedback}
            maxLength={5000}
            onChange={(e) => setDraft((d) => ({ ...d, feedback: e.target.value }))}
          />
        ) : (
          <p className="whitespace-pre-wrap">
            {draft.feedback || <span className="text-muted-foreground">—</span>}
          </p>
        )}
      </label>
      {editing && problems.length > 0 && (
        <ErrorAlert>
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </ErrorAlert>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button disabled={busy || problems.length > 0} onClick={() => onSave(draft)}>
                Save marks
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDraft(draftFrom(detail, question.criteria));
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              {canAccept && (
                <Button disabled={busy} onClick={onAccept}>
                  <CheckIcon />
                  Accept AI grade
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                <PencilIcon />
                {current ? 'Edit marks' : 'Grade manually'}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
