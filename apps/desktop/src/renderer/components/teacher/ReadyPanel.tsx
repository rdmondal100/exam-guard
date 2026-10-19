import type { ExamSummary, ReadyProblem } from '@examguard/shared';
import { Button } from '@/components/ui/button';

interface Props {
  state: ExamSummary['state'];
  problems: ReadyProblem[];
  busy: boolean;
  onMarkReady: () => void;
  onBackToDraft: () => void;
}

/** Mark Ready / Back to draft, plus the reasons when Ready was refused. */
export function ReadyPanel({ state, problems, busy, onMarkReady, onBackToDraft }: Props) {
  return (
    <section
      aria-label="Ready check"
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      {state === 'draft' && (
        <div className="flex items-center gap-3">
          <Button disabled={busy} onClick={onMarkReady}>
            Mark ready
          </Button>
          <span className="text-sm text-muted">
            Checks the class list, questions and marking guides.
          </span>
        </div>
      )}
      {state === 'ready' && (
        <div className="flex items-center gap-3">
          <span className="font-medium text-green-700">Ready to host.</span>
          <Button variant="outline" disabled={busy} onClick={onBackToDraft}>
            Back to draft
          </Button>
        </div>
      )}
      {state !== 'draft' && state !== 'ready' && (
        <p className="text-sm text-muted">
          This exam is {state.replace('_', ' ')} and can no longer be edited.
        </p>
      )}
      {problems.length > 0 && (
        <div role="alert" className="text-red-700">
          <p className="font-medium">Not ready yet:</p>
          <ul className="list-disc pl-6">
            {problems.map((p, index) => (
              <li key={`${p.code}-${p.questionId ?? index}`}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
