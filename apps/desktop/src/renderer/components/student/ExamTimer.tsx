import { useEffect, useState } from 'react';
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
  return (
    <p
      role="timer"
      aria-label="Time left"
      className={`font-mono text-2xl tabular-nums ${left < 5 * 60_000 ? 'text-red-700' : ''}`}
    >
      {left === 0 ? 'Time is up' : formatRemaining(left)}
    </p>
  );
}
