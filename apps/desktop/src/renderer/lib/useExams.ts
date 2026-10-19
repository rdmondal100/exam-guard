import { useCallback, useEffect, useState } from 'react';
import type { ExamSummary } from '@examguard/shared';
import { createExamApi, type ExamApi } from './examApi';

/** The exams plus an API handle, loaded once the server connection is known. */
export function useExams() {
  const [api, setApi] = useState<ExamApi | null>(null);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      .then(async (connection) => {
        if (!connection) throw new Error('The exam server is not running');
        const next = createExamApi(connection);
        if (cancelled) return;
        setApi(next);
        await refresh(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return { api, exams, error, reload: () => (api ? refresh(api) : Promise.resolve()) };
}
