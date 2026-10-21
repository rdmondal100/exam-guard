import type { StudentQuestion } from '@examguard/shared';

interface Props {
  questions: StudentQuestion[];
  selectedId: string;
  answered: ReadonlySet<string>;
  onSelect: (id: string) => void;
}

/** Numbered question buttons; a dot marks the ones with some text typed. */
export function QuestionNav({ questions, selectedId, answered, onSelect }: Props) {
  return (
    <nav aria-label="Questions" className="flex flex-col gap-1">
      {questions.map((q) => (
        <button
          key={q.id}
          type="button"
          aria-current={q.id === selectedId ? 'true' : undefined}
          onClick={() => onSelect(q.id)}
          className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
            q.id === selectedId ? 'bg-primary text-white' : 'hover:bg-black/5'
          }`}
        >
          <span>Question {q.position}</span>
          {answered.has(q.id) && <span aria-label="Has an answer">●</span>}
        </button>
      ))}
    </nav>
  );
}
