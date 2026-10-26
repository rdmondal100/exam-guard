import { useEffect, useState } from 'react';
import type { EventRow } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/lib/examApi';
import { clockTime } from '@/lib/terminalLog';
import { describeEvent } from '@/lib/eventsView';

interface Props {
  event: EventRow;
  api: ExamApi;
  onClose: () => void;
}

/** The screenshot an agent took with one event, full size. */
export function ScreenshotDialog({ event, api, onClose }: Props) {
  const [picture, setPicture] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPicture(null);
    setError(null);
    api
      .screenshot(event.id)
      .then((url) => {
        if (!cancelled) setPicture(url);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [api, event.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    >
      <div className="flex max-h-full w-full max-w-6xl flex-col gap-3 rounded-md bg-card p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">
              {event.studentName ?? 'Unknown student'}{' '}
              <span className="font-mono text-muted">{event.studentCode}</span>
            </h2>
            <p className="truncate text-sm text-muted">
              {clockTime(event.serverTs)} · {describeEvent(event)}
            </p>
          </div>
          <Button className="ml-auto h-8 px-3" onClick={onClose}>
            Close
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {!picture && !error && <p className="text-sm text-muted">Loading…</p>}
        {picture && (
          <img
            src={picture}
            alt={`Screen of ${event.studentName ?? 'the student'} at ${clockTime(event.serverTs)}`}
            className="min-h-0 w-full flex-1 rounded-md border border-border object-contain"
          />
        )}
      </div>
    </div>
  );
}
