import { CircleCheckIcon } from 'lucide-react';
import type { StudentQuestion } from '@examguard/shared';
import { cn } from '@/lib/utils';

interface Props {
  questions: StudentQuestion[];
  selectedId: string;
  answered: ReadonlySet<string>;
  onSelect: (id: string) => void;
}

/** Numbered question buttons; a check marks the ones with some text typed. */
export function QuestionNav({ questions, selectedId, answered, onSelect }: Props) {
  return (
    <nav aria-label="Questions" className="flex flex-col gap-1">
      {questions.map((q) => {
        const selected = q.id === selectedId;
        return (
          <button
            key={q.id}
            type="button"
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(q.id)}
            className={cn(
              'flex h-9 items-center justify-between gap-2 rounded-md px-3 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              selected
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <span>Question {q.position}</span>
            {answered.has(q.id) && (
              <CircleCheckIcon
                aria-label="Has an answer"
                className={cn('size-4', selected ? 'text-primary-foreground' : 'text-success')}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
