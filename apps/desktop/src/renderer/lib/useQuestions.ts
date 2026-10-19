import { useCallback, useEffect, useState } from 'react';
import type { Question } from '@examguard/shared';
import { createQuestionApi, type QuestionApi } from './questionApi';

/** One exam's questions plus an API handle, loaded once the server connection is known. */
export function useQuestions(examId: string) {
  const [api, setApi] = useState<QuestionApi | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (target: QuestionApi) => {
      try {
        setQuestions(await target.list(examId));
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
        const next = createQuestionApi(connection);
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

  return { api, questions, error, reload: () => (api ? refresh(api) : Promise.resolve()) };
}
