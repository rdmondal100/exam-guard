import { useCallback, useEffect, useState } from 'react';
import type { ClassListSummary } from '@examguard/shared';
import { createClassListApi, type ClassListApi } from './classListApi';

/** The class lists plus an API handle, loaded once the server connection is known. */
export function useClassLists() {
  const [api, setApi] = useState<ClassListApi | null>(null);
  const [lists, setLists] = useState<ClassListSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (target: ClassListApi) => {
    try {
      setLists(await target.list());
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
        const next = createClassListApi(connection);
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

  return { api, lists, error, reload: () => (api ? refresh(api) : Promise.resolve()) };
}
