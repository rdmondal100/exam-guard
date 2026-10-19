import type { Question } from '@examguard/shared';
import { Button } from '@/components/ui/button';

interface Props {
  questions: Question[];
  /** Question ids that the last Ready check flagged. */
  flagged: ReadonlySet<string>;
  disabled: boolean;
  onEdit: (question: Question) => void;
  onDelete: (question: Question) => void;
  /** Moves the question one place up (-1) or down (+1). */
  onMove: (question: Question, delta: -1 | 1) => void;
}

const firstLine = (text: string) => text.split('\n')[0]?.slice(0, 90) ?? '';

/** The exam's questions in order, with edit, delete and move up/down. */
export function QuestionList({ questions, flagged, disabled, onEdit, onDelete, onMove }: Props) {
  if (questions.length === 0) {
    return <p className="text-muted">No questions yet. Add a code or written question.</p>;
  }
  const total = questions.reduce((sum, q) => sum + q.marks, 0);
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {questions.map((q, index) => (
          <li
            key={q.id}
            className="flex items-center gap-3 rounded-md border border-border bg-card p-3 data-[flagged=true]:border-red-700"
            data-flagged={flagged.has(q.id)}
          >
            <span className="w-6 text-sm font-semibold">{q.position}.</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{firstLine(q.body)}</p>
              <p className="text-xs text-muted">
                {q.type === 'code'
                  ? `Code (${q.allowedLanguages.join(', ') || 'no language'})`
                  : 'Written'}
                {' · '}
                {q.marks} marks · {q.criteria.length} criteria
              </p>
            </div>
            <Button
              variant="outline"
              aria-label={`Move question ${q.position} up`}
              disabled={disabled || index === 0}
              onClick={() => onMove(q, -1)}
            >
              ↑
            </Button>
            <Button
              variant="outline"
              aria-label={`Move question ${q.position} down`}
              disabled={disabled || index === questions.length - 1}
              onClick={() => onMove(q, 1)}
            >
              ↓
            </Button>
            <Button variant="outline" disabled={disabled} onClick={() => onEdit(q)}>
              Edit
            </Button>
            <Button variant="outline" disabled={disabled} onClick={() => onDelete(q)}>
              Delete
            </Button>
          </li>
        ))}
      </ol>
      <p className="text-sm font-medium">Total: {total} marks</p>
    </div>
  );
}
