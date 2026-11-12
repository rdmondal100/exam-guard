import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { PackageIcon, RefreshCwIcon } from 'lucide-react';
import type { TerminalLogResponse } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ExamApi } from '@/api/examApi';
import { clockTime, describeTerminalEvent } from '@/lib/terminalLog';
import { ErrorAlert } from '../common/ErrorAlert';
import { LoadingLine } from '../common/Spinner';

const TerminalTranscript = lazy(() => import('./TerminalTranscript'));

interface Props {
  examId: string;
  student: { id: string; name: string; studentCode: string };
  api: ExamApi;
  onClose: () => void;
}

/** A student's terminal: every command and install as logged, and the full transcript. */
export function TerminalLogDialog({ examId, student, api, onClose }: Props) {
  const [log, setLog] = useState<TerminalLogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .terminalLog(examId, student.id)
      .then(setLog)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, examId, student.id]);
  useEffect(load, [load]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-label={`Terminal log of ${student.name}`}
        aria-describedby={undefined}
        className="flex h-[calc(100vh-4rem)] max-h-[48rem] flex-col sm:max-w-6xl"
      >
        <DialogHeader className="flex-row items-center gap-3 pr-8">
          <DialogTitle>
            Terminal · {student.name}{' '}
            <span className="font-mono font-normal text-muted-foreground">
              {student.studentCode}
            </span>
          </DialogTitle>
          <Button size="sm" variant="outline" className="ml-auto" onClick={load}>
            <RefreshCwIcon />
            Refresh
          </Button>
        </DialogHeader>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {!log && !error && <LoadingLine>Loading…</LoadingLine>}
        {log && (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,2fr)_3fr] gap-3">
            <ol
              aria-label="Commands"
              className="min-h-0 overflow-auto rounded-md border p-2 font-mono text-xs"
            >
              {log.events.length === 0 && (
                <li className="font-sans text-sm text-muted-foreground">No terminal use yet.</li>
              )}
              {log.events.map((e) => (
                <li
                  key={e.id}
                  className={cn(
                    'flex gap-2 py-0.5',
                    e.type === 'package_installed' && 'font-medium text-info',
                  )}
                >
                  <span className="shrink-0 text-muted-foreground">{clockTime(e.serverTs)}</span>
                  {e.type === 'package_installed' && (
                    <PackageIcon className="mt-px size-3 shrink-0" aria-hidden />
                  )}
                  <span className="break-all">{describeTerminalEvent(e)}</span>
                </li>
              ))}
            </ol>
            <div className="flex min-h-0 flex-col gap-1">
              {log.truncated && (
                <p className="text-sm text-warning">
                  The transcript reached 1 MB; later output was not kept.
                </p>
              )}
              <div className="min-h-0 flex-1">
                <Suspense fallback={<LoadingLine>Loading transcript…</LoadingLine>}>
                  <TerminalTranscript text={log.transcript} />
                </Suspense>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
