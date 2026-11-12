import { useEffect, useState } from 'react';
import { ClockIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRemaining, remainingMs } from '../../lib/examClock';

interface Props {
  deadline: number;
  offsetMs: number | null;
}

/** Counts down to the server deadline, using the estimated server clock offset. */
export function ExamTimer({ deadline, offsetMs }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const left = remainingMs(deadline, now, offsetMs);
  const low = left < 5 * 60_000;
  return (
    <p
      role="timer"
      aria-label="Time left"
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-1 font-mono text-xl font-semibold tabular-nums',
        low && 'border-destructive/40 bg-destructive/10 text-destructive',
      )}
    >
      <ClockIcon className="size-4" aria-hidden />
      {left === 0 ? 'Time is up' : formatRemaining(left)}
    </p>
  );
}
