import type { Evaluation } from '@examguard/shared';
import { clockTime } from '@/lib/terminalLog';

interface Props {
  history: readonly Evaluation[];
  /** The evaluation the grade points at. */
  currentId: number | null;
  max: number;
}

const STATUS_TEXT: Record<Evaluation['status'], string> = {
  ok: 'graded',
  invalid: 'invalid reply',
  error: 'call failed',
};

function who(e: Evaluation): string {
  if (e.author === 'teacher') return 'Teacher';
  return `AI (${e.provider ?? '?'} ${e.model ?? ''}, ${e.promptVersion ?? ''}) attempt ${e.attempt}`;
}

/** Every AI attempt and teacher entry for one answer, oldest first (M40). */
export function GradeHistory({ history, currentId, max }: Props) {
  if (history.length === 0) return <p className="text-sm text-muted">No grading yet.</p>;
  return (
    <ol aria-label="Grading history" className="flex flex-col gap-2 text-sm">
      {history.map((e) => (
        <li
          key={e.id}
          className={`rounded-md border p-2 ${e.id === currentId ? 'border-sky-500' : 'border-border'}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-muted">{clockTime(e.createdAt)}</span>
            <span className="font-medium">{who(e)}</span>
            <span className={e.status === 'ok' ? 'text-green-700' : 'text-red-700'}>
              {STATUS_TEXT[e.status]}
            </span>
            {e.total !== null && (
              <span>
                {e.total} / {max}
              </span>
            )}
            {e.confidence && <span className="text-muted">confidence {e.confidence}</span>}
            {e.id === currentId && <span className="text-sky-700">(current)</span>}
          </div>
          {e.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-700">
              {e.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {e.author === 'teacher' && e.feedback && <p className="mt-1">{e.feedback}</p>}
          {e.rawResponse && (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted">Raw response</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs">
                {e.rawResponse}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
