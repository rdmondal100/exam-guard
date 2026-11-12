import { useEffect, useState } from 'react';
import type { EventRow } from '@examguard/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ExamApi } from '@/api/examApi';
import { clockTime } from '@/lib/terminalLog';
import { describeEvent } from '@/lib/eventsView';
import { ErrorAlert } from '../common/ErrorAlert';
import { LoadingLine } from '../common/Spinner';

interface Props {
  event: EventRow;
  api: ExamApi;
  onClose: () => void;
}

/** The screenshot a student app took with one event, full size. */
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-label="Screenshot"
        className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-6xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">
            {event.studentName ?? 'Unknown student'}{' '}
            <span className="font-mono font-normal text-muted-foreground">{event.studentCode}</span>
          </DialogTitle>
          <DialogDescription className="truncate">
            {clockTime(event.serverTs)} · {describeEvent(event)}
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {!picture && !error && <LoadingLine>Loading…</LoadingLine>}
        {picture && (
          <img
            src={picture}
            alt={`Screen of ${event.studentName ?? 'the student'} at ${clockTime(event.serverTs)}`}
            className="min-h-0 w-full flex-1 rounded-md border object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
