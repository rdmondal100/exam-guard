import { useEffect, useState } from 'react';
import { ClockIcon, PauseIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRemaining, remainingMs } from '../../lib/examClock';

interface Props {
  deadline: number;
  offsetMs: number | null;
  /** While the teacher has the exam paused (M58) the clock stands still. */
  pausedAt?: number | null;
}

/** Counts down to the server deadline, using the estimated server clock offset. */
export function ExamTimer({ deadline, offsetMs, pausedAt = null }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const left = remainingMs(deadline, now, offsetMs, pausedAt);
  const low = left < 5 * 60_000;
  return (
    <p
      role="timer"
      aria-label={pausedAt === null ? 'Time left' : 'Time left (paused)'}
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-1 font-mono text-xl font-semibold tabular-nums',
        low && 'border-destructive/40 bg-destructive/10 text-destructive',
        pausedAt !== null && 'border-warning/40 bg-warning/10 text-warning',
      )}
    >
      {pausedAt === null ? (
        <ClockIcon className="size-4" aria-hidden />
      ) : (
        <PauseIcon className="size-4" aria-hidden />
      )}
      {left === 0 ? 'Time is up' : formatRemaining(left)}
    </p>
  );
}
