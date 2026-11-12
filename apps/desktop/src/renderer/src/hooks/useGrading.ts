import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GradingStatus, ServerConnection } from '@examguard/shared';
import { createGradingApi, type GradingApi } from '../api/gradingApi';

export interface GradingView {
  api: GradingApi | null;
  status: GradingStatus | null;
  error: string | null;
  reload(): Promise<void>;
  /** Shows a status the caller already has (a start or cancel answer). */
  set(status: GradingStatus): void;
}

/**
 * The exam's grading status (M38): fetched once and after each socket (re)connect, then kept
 * current by `grading.progress` pushes (`pushed`).
 */
export function useGrading(
  examId: string,
  pushed: GradingStatus | null,
  connects: number,
  enabled: boolean,
): GradingView {
  const [connection, setConnection] = useState<ServerConnection | null>(null);
  const [status, setStatus] = useState<GradingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = useMemo(() => (connection ? createGradingApi(connection) : null), [connection]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void window.examguard.getServerConnection().then((next) => {
      if (!cancelled) setConnection(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      setStatus(await api.status(examId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, examId]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload, connects]);

  useEffect(() => {
    if (pushed?.examId === examId) setStatus(pushed);
  }, [pushed, examId]);

  return { api, status, error, reload, set: setStatus };
}
