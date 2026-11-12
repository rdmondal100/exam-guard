import { CircleCheckIcon, CircleDashedIcon, LockIcon, PlayIcon, Undo2Icon } from 'lucide-react';
import type { ExamSummary, ReadyProblem } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorAlert } from '../common/ErrorAlert';

interface Props {
  state: ExamSummary['state'];
  problems: ReadyProblem[];
  busy: boolean;
  onMarkReady: () => void;
  onBackToDraft: () => void;
  onHost: () => void;
}

/** Mark Ready / Back to draft, plus the reasons when Ready was refused. */
export function ReadyPanel({ state, problems, busy, onMarkReady, onBackToDraft, onHost }: Props) {
  const locked = state !== 'draft' && state !== 'ready' && state !== 'hosting';
  if (state === 'hosting' && problems.length === 0) return null;
  return (
    <Card aria-label="Ready check" className="py-4">
      <CardContent className="flex flex-col gap-3">
        {state === 'draft' && (
          <div className="flex flex-wrap items-center gap-3">
            <CircleDashedIcon className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-sm text-muted-foreground">
              Checks the class list, questions and marking guides.
            </span>
            <Button className="ml-auto" disabled={busy} onClick={onMarkReady}>
              Mark ready
            </Button>
          </div>
        )}
        {state === 'ready' && (
          <div className="flex flex-wrap items-center gap-3">
            <CircleCheckIcon className="size-5 text-success" aria-hidden />
            <span className="font-medium text-success">Ready to host.</span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" disabled={busy} onClick={onBackToDraft}>
                <Undo2Icon />
                Back to draft
              </Button>
              <Button disabled={busy} onClick={onHost}>
                <PlayIcon />
                Start hosting
              </Button>
            </div>
          </div>
        )}
        {locked && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LockIcon className="size-4" aria-hidden />
            This exam is {state.replace('_', ' ')} and can no longer be edited.
          </p>
        )}
        {problems.length > 0 && (
          <ErrorAlert title="Not ready yet:">
            <ul className="list-disc pl-5">
              {problems.map((p, index) => (
                <li key={`${p.code}-${p.questionId ?? index}`}>{p.message}</li>
              ))}
            </ul>
          </ErrorAlert>
        )}
      </CardContent>
    </Card>
  );
}
