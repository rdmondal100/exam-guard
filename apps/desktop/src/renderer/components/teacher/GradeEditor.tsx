import { useState } from 'react';
import type { AnswerDetail, Question } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { draftFrom, draftProblems, draftTotal, type GradeDraft } from '@/lib/grading';

interface Props {
  detail: AnswerDetail;
  question: Question;
  /** In review only: before that grading runs, after it the marks are locked. */
  editable: boolean;
  busy: boolean;
  onAccept: () => void;
  onSave: (draft: GradeDraft) => void;
}

const INPUT = 'h-8 rounded-md border border-border bg-background px-2';

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
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-muted">
            <th className="py-1 pr-2 font-medium">Criterion</th>
            <th className="py-1 pr-2 font-medium">Marks</th>
            <th className="py-1 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {draft.criteria.map((c, i) => (
            <tr key={c.name} className="border-t border-border align-top">
              <td className="py-1.5 pr-2">{c.name}</td>
              <td className="whitespace-nowrap py-1.5 pr-2">
                {editing ? (
                  <input
                    aria-label={`Marks for ${c.name}`}
                    type="number"
                    min={0}
                    max={c.max}
                    step={0.5}
                    className={`${INPUT} w-20`}
                    value={c.awarded}
                    onChange={(e) => setCriterion(i, { awarded: e.target.value })}
                  />
                ) : (
                  c.awarded
                )}{' '}
                / {c.max}
              </td>
              <td className="py-1.5">
                {editing ? (
                  <input
                    aria-label={`Reason for ${c.name}`}
                    className={`${INPUT} w-full`}
                    value={c.reason}
                    onChange={(e) => setCriterion(i, { reason: e.target.value })}
                  />
                ) : (
                  c.reason || <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border font-medium">
            <td className="py-1.5">Total</td>
            <td className="py-1.5" colSpan={2}>
              {current || editing
                ? `${draftTotal(draft)} / ${question.marks}`
                : `— / ${question.marks}`}
            </td>
          </tr>
        </tbody>
      </table>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Feedback for the student</span>
        {editing ? (
          <textarea
            className="min-h-24 rounded-md border border-border bg-background p-2"
            value={draft.feedback}
            maxLength={5000}
            onChange={(e) => setDraft((d) => ({ ...d, feedback: e.target.value }))}
          />
        ) : (
          <p className="whitespace-pre-wrap">
            {draft.feedback || <span className="text-muted">—</span>}
          </p>
        )}
      </label>
      {editing && problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-red-700">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
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
                  Accept AI grade
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                {current ? 'Edit marks' : 'Grade manually'}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
