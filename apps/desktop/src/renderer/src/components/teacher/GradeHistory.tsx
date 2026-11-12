import { ChevronRightIcon } from 'lucide-react';
import type { Evaluation } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
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
  if (history.length === 0) return <p className="text-sm text-muted-foreground">No grading yet.</p>;
  return (
    <ol aria-label="Grading history" className="flex flex-col gap-2 text-sm">
      {history.map((e) => (
        <li
          key={e.id}
          className={cn(
            'rounded-lg border p-3',
            e.id === currentId && 'border-primary/50 bg-primary/5',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {clockTime(e.createdAt)}
            </span>
            <span className="font-medium">{who(e)}</span>
            <Badge variant={e.status === 'ok' ? 'success' : 'danger'}>
              {STATUS_TEXT[e.status]}
            </Badge>
            {e.total !== null && (
              <span className="font-medium">
                {e.total} / {max}
              </span>
            )}
            {e.confidence && (
              <span className="text-muted-foreground">confidence {e.confidence}</span>
            )}
            {e.id === currentId && <Badge variant="primary">(current)</Badge>}
          </div>
          {e.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-destructive">
              {e.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {e.author === 'teacher' && e.feedback && <p className="mt-1">{e.feedback}</p>}
          {e.rawResponse && (
            <Collapsible className="group/raw mt-2">
              <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronRightIcon
                  className="size-3.5 transition-transform group-data-[state=open]/raw:rotate-90"
                  aria-hidden
                />
                Raw response
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                  {e.rawResponse}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </li>
      ))}
    </ol>
  );
}
