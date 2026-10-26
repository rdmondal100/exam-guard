import { useEffect, useState } from 'react';
import type { EventRow } from '@examguard/shared';
import type { ExamApi } from './examApi';

const REFRESH_MS = 3000;

export interface EventsView {
  events: EventRow[];
  error: string | null;
}

/** What the agents saw in this exam, newest first, fetched again every few seconds. */
export function useEvents(examId: string, api: ExamApi): EventsView {
  const [view, setView] = useState<EventsView>({ events: [], error: null });
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .events(examId, { limit: 200 })
        .then((events) => {
          if (!cancelled) setView({ events, error: null });
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setView((old) => ({ ...old, error: e instanceof Error ? e.message : String(e) }));
          }
        });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, examId]);
  return view;
}
