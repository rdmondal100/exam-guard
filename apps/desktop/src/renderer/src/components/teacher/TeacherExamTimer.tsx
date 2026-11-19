import { useEffect, useState } from 'react';
import { ClockIcon, PauseIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRemaining, remainingMs } from '@/lib/examClock';

interface Props {
  /** The exam's end for everyone (server time; the teacher PC runs the server). */
  deadline: number;
  /** Minutes added for everyone, shown as "+N min". */
  extensionMin: number;
  /** The exam is paused (M58): the clock stands still. */
  pausedAt?: number | null;
}

/**
 * The exam countdown on the teacher's screen (M56): the same clock the students see, large, red in
 * the last five minutes. Students with personal extra time end later.
 */
export function TeacherExamTimer({ deadline, extensionMin, pausedAt = null }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  // The teacher UI runs on the server's PC, so there is no clock offset.
  const left = remainingMs(deadline, now, null, pausedAt);
  const low = left < 5 * 60_000;
  return (
    <div
      role="timer"
      aria-label={pausedAt === null ? 'Time left in the exam' : 'Time left (paused)'}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-1.5',
        low && 'border-destructive/40 bg-destructive/10 text-destructive',
        pausedAt !== null && 'border-warning/40 bg-warning/10 text-warning',
      )}
    >
      {pausedAt === null ? (
        <ClockIcon className="size-5" aria-hidden />
      ) : (
        <PauseIcon className="size-5" aria-hidden />
      )}
      <span className="font-mono text-2xl font-semibold tabular-nums">
        {left === 0 ? 'Time is up' : formatRemaining(left)}
      </span>
      {pausedAt !== null && <span className="text-xs font-semibold uppercase">Paused</span>}
      {extensionMin > 0 && (
        <span className="text-xs font-medium text-muted-foreground">+{extensionMin} min</span>
      )}
    </div>
  );
}
