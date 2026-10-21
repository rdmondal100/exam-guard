import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExamSummary, ServerConnection } from '@examguard/shared';
import { createExamApi, type ExamApi } from './examApi';

/** The exams plus an API handle, loaded once the server connection is known. */
export function useExams() {
  const [connection, setConnection] = useState<ServerConnection | null>(null);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Derived, not stored in state: a hot reload of examApi.ts then yields the new methods.
  const api = useMemo(() => (connection ? createExamApi(connection) : null), [connection]);

  const refresh = useCallback(async (target: ExamApi) => {
    try {
      setExams(await target.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.examguard
      .getServerConnection()
      .then((next) => {
        if (!next) throw new Error('The exam server is not running');
        if (!cancelled) setConnection(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (api) void refresh(api);
  }, [api, refresh]);

  return { api, exams, error, reload: () => (api ? refresh(api) : Promise.resolve()) };
}
