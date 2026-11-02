import { useEffect, useRef, useState } from 'react';
import type { ExamApi } from '@/api/examApi';

const POLL_MS = 5000;

/** The relay's counters under the grid: how many PCs stream, and the traffic to this screen. */
export function ThumbStatsLine({ api }: { api: ExamApi }) {
  const [line, setLine] = useState<string | null>(null);
  const last = useRef<{ at: number; bytesOut: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      void api
        .thumbStats()
        .then((stats) => {
          if (cancelled) return;
          const at = Date.now();
          const before = last.current;
          last.current = { at, bytesOut: stats.bytesOut };
          const rate =
            before && at > before.at && stats.bytesOut >= before.bytesOut
              ? ` · ${((stats.bytesOut - before.bytesOut) / 1024 / ((at - before.at) / 1000)).toFixed(0)} KB/s`
              : '';
          setLine(`Streaming ${stats.streaming} screen${stats.streaming === 1 ? '' : 's'}${rate}`);
        })
        .catch(() => {
          if (!cancelled) setLine(null);
        });
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api]);

  if (!line) return null;
  return <p className="text-xs text-muted">{line} · pictures are kept in memory only</p>;
}
