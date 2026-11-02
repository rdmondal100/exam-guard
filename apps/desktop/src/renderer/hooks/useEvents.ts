import { useEffect, useMemo, useState } from 'react';
import type { EventRow, Severity } from '@examguard/shared';
import type { ExamApi } from '../api/examApi';
import { FEED_LIMIT, mergeEvents } from '../lib/eventFeed';

const NO_ALERTS: readonly EventRow[] = [];

export interface EventsView {
  events: EventRow[];
  error: string | null;
}

export interface EventsOptions {
  /** One student's timeline (M32). */
  studentId?: string;
  /** This severity and above (M31). */
  minSeverity?: Severity;
  /** Alerts pushed over the teacher socket since it opened, newest first. */
  live?: readonly EventRow[];
  /** Changes on each socket (re)connect: the list is fetched again to fill the gap. */
  connects?: number;
}

/**
 * What the agents saw in this exam, newest first: fetched once per filter and reconnect, then
 * kept current by the live alerts (M31).
 */
export function useEvents(examId: string, api: ExamApi, options: EventsOptions = {}): EventsView {
  const { studentId, minSeverity, live = NO_ALERTS, connects = 0 } = options;
  const [loaded, setLoaded] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded([]);
    api
      .events(examId, {
        limit: FEED_LIMIT,
        ...(studentId ? { studentId } : {}),
        ...(minSeverity && minSeverity !== 'low' ? { minSeverity } : {}),
      })
      .then((events) => {
        if (cancelled) return;
        setLoaded(events);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [api, examId, studentId, minSeverity, connects]);

  const events = useMemo(
    () =>
      mergeEvents(loaded, live, {
        ...(studentId ? { studentId } : {}),
        ...(minSeverity ? { minSeverity } : {}),
      }),
    [loaded, live, studentId, minSeverity],
  );
  return { events, error };
}
