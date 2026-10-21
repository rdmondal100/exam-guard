import { useMemo, useState } from 'react';
import type { SessionStatus, StudentQuestion } from '@examguard/shared';
import { ExamTimer } from './ExamTimer';
import { LINK_TEXT } from './LobbyScreen';
import { QuestionNav } from './QuestionNav';

interface Props {
  name: string;
  examTitle: string;
  questions: StudentQuestion[];
  deadline: number;
  status: SessionStatus;
}

/**
 * The exam window: question list, a written answer box, the server timer, the connection state
 * and a monitoring badge. Answers are kept in memory only; autosave arrives with M16 and the
 * code editor with M14.
 */
export function ExamScreen({ name, examTitle, questions, deadline, status }: Props) {
  const [selectedId, setSelectedId] = useState(questions[0]?.id ?? '');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const question = questions.find((q) => q.id === selectedId) ?? questions[0];
  const answered = useMemo(
    () => new Set(Object.entries(answers).flatMap(([id, text]) => (text.trim() ? [id] : []))),
    [answers],
  );
  const linkOk = status.link === 'connected';

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">{examTitle}</h1>
          <p className="text-sm text-muted">{name}</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="rounded-md bg-blue-100 px-3 py-1 text-sm text-blue-900">
            Monitoring active
          </span>
          <span
            role="status"
            className={`rounded-md px-3 py-1 text-sm ${
              linkOk ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'
            }`}
          >
            {LINK_TEXT[status.link]}
          </span>
          <ExamTimer deadline={deadline} offsetMs={status.offsetMs} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-48 shrink-0 overflow-y-auto border-r p-3">
          <QuestionNav
            questions={questions}
            selectedId={question?.id ?? ''}
            answered={answered}
            onSelect={setSelectedId}
          />
        </aside>
        {question ? (
          <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
            <h2 className="text-base font-semibold">
              Question {question.position} · {question.marks} marks
            </h2>
            <p className="whitespace-pre-wrap">{question.body}</p>
            {question.studentNote && (
              <p className="whitespace-pre-wrap rounded-md bg-black/5 p-3 text-sm">
                {question.studentNote}
              </p>
            )}
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
              Your answer
              <textarea
                value={answers[question.id] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
                className="min-h-48 flex-1 resize-none rounded-md border p-3 font-mono text-sm font-normal"
                spellCheck={false}
              />
            </label>
          </main>
        ) : (
          <main className="p-6">This exam has no questions.</main>
        )}
      </div>
    </div>
  );
}
