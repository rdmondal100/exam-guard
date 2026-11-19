import { PauseIcon, WifiOffIcon } from 'lucide-react';
import type { SessionStatus } from '@examguard/shared';
import { useTick } from '@/hooks/useTick';
import { formatRemaining } from '@/lib/examClock';

interface Props {
  /** When the teacher paused the exam, in server time. */
  pausedAt: number;
  /** The deadline as it stands (it moves by the pause on resume). */
  deadline: number;
  status: SessionStatus;
}

/**
 * Covers the exam while the teacher has paused it for everyone (M58). Only the teacher can resume,
 * so this is a plain overlay; the exam under it is inert, so nothing can be typed. The timer stands
 * still and the time spent paused is given back on resume. It shows how long the pause has lasted,
 * the time left, and whether the resume can reach this PC (M64).
 */
export function ExamPausedOverlay({ pausedAt, deadline, status }: Props) {
  const pausedFor = useTick((now) =>
    formatRemaining(Math.max(0, now + (status.offsetMs ?? 0) - pausedAt)),
  );
  const left = formatRemaining(Math.max(0, deadline - pausedAt));
  const online = status.link === 'connected';
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exam-paused-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-8 backdrop-blur-sm"
    >
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
          <PauseIcon className="size-8" aria-hidden />
        </div>
        <h1 id="exam-paused-title" className="text-3xl font-semibold">
          Your teacher paused the exam
        </h1>
        <p className="text-lg">Please wait. The exam continues when your teacher resumes it.</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono tabular-nums">
          <dt className="text-right font-sans text-muted-foreground">Paused for</dt>
          <dd className="text-left">{pausedFor}</dd>
          <dt className="text-right font-sans text-muted-foreground">Time left</dt>
          <dd className="text-left">{left}</dd>
        </dl>
        <p className="text-sm text-muted-foreground">
          Your answers so far are saved. The timer is stopped, so you lose no time.
        </p>
        {!online && (
          <p role="status" className="flex items-center gap-2 text-sm text-warning">
            <WifiOffIcon className="size-4" aria-hidden />
            Connection lost. The app keeps trying; the exam opens again as soon as it is back.
          </p>
        )}
      </div>
    </div>
  );
}
