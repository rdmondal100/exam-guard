import { ArrowDownIcon, ArrowUpIcon, FileTextIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { Question } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EmptyState } from '../common/EmptyState';

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
    return (
      <EmptyState
        icon={FileTextIcon}
        title="No questions yet"
        description="Add a code or written question."
      />
    );
  }
  const total = questions.reduce((sum, q) => sum + q.marks, 0);
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {questions.map((q, index) => (
          <li
            key={q.id}
            data-flagged={flagged.has(q.id)}
            className={cn(
              'flex items-center gap-3 rounded-lg border bg-card p-3 shadow-xs',
              'data-[flagged=true]:border-destructive data-[flagged=true]:bg-destructive/5',
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
              {q.position}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate text-sm font-medium">{firstLine(q.body)}</p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant={q.type === 'code' ? 'info' : 'neutral'}>
                  {q.type === 'code'
                    ? `Code (${q.allowedLanguages.join(', ') || 'no language'})`
                    : 'Written'}
                </Badge>
                <span>
                  {q.marks} marks · {q.criteria.length} criteria
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move question ${q.position} up`}
                disabled={disabled || index === 0}
                onClick={() => onMove(q, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move question ${q.position} down`}
                disabled={disabled || index === questions.length - 1}
                onClick={() => onMove(q, 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => onEdit(q)}>
                <PencilIcon />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete question ${q.position}`}
                disabled={disabled}
                onClick={() => onDelete(q)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <p className="self-end text-sm font-medium">Total: {total} marks</p>
    </div>
  );
}
