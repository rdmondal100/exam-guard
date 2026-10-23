import { useCallback, useEffect, useState } from 'react';
import type { ExamFile } from '@examguard/shared';
import { createExamFileApi, type ExamFileApi } from './examFileApi';

/** One exam's attached files plus an API handle, loaded once the server connection is known. */
export function useExamFiles(examId: string) {
  const [api, setApi] = useState<ExamFileApi | null>(null);
  const [files, setFiles] = useState<ExamFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (target: ExamFileApi) => {
      try {
        setFiles(await target.list(examId));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [examId],
  );

  useEffect(() => {
    let cancelled = false;
    window.examguard
      .getServerConnection()
      .then(async (connection) => {
        if (!connection) throw new Error('The exam server is not running');
        const next = createExamFileApi(connection);
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

  return { api, files, error, reload: () => (api ? refresh(api) : Promise.resolve()) };
}
