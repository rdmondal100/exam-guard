import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { TerminalLogResponse } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/lib/examApi';
import { clockTime, describeTerminalEvent } from '@/lib/terminalLog';

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Terminal log of ${student.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    >
      <div className="flex h-full max-h-[48rem] w-full max-w-6xl flex-col gap-3 rounded-md bg-card p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            Terminal · {student.name}{' '}
            <span className="font-mono text-muted">{student.studentCode}</span>
          </h2>
          <div className="ml-auto flex gap-2">
            <Button className="h-8 px-3" variant="outline" onClick={load}>
              Refresh
            </Button>
            <Button className="h-8 px-3" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {!log && !error && <p className="text-sm text-muted">Loading…</p>}
        {log && (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,2fr)_3fr] gap-3">
            <ol aria-label="Commands" className="min-h-0 overflow-auto font-mono text-xs">
              {log.events.length === 0 && (
                <li className="font-sans text-sm text-muted">No terminal use yet.</li>
              )}
              {log.events.map((e) => (
                <li
                  key={e.id}
                  className={`flex gap-2 py-0.5 ${e.type === 'package_installed' ? 'text-blue-800' : ''}`}
                >
                  <span className="shrink-0 text-muted">{clockTime(e.serverTs)}</span>
                  <span className="break-all">{describeTerminalEvent(e)}</span>
                </li>
              ))}
            </ol>
            <div className="flex min-h-0 flex-col gap-1">
              {log.truncated && (
                <p className="text-sm text-amber-700">
                  The transcript reached 1 MB; later output was not kept.
                </p>
              )}
              <div className="min-h-0 flex-1">
                <Suspense fallback={<p className="text-sm text-muted">Loading transcript…</p>}>
                  <TerminalTranscript text={log.transcript} />
                </Suspense>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
