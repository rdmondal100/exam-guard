import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthStatus, ServerStatus } from '@examguard/shared';
import { createAuthApi, type AuthApi } from './teacherApi';

export type AuthView =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'setup' }
  | { kind: 'login' }
  | { kind: 'home' };

function toView(status: AuthStatus): AuthView {
  if (status.setupRequired) return { kind: 'setup' };
  return status.loggedIn ? { kind: 'home' } : { kind: 'login' };
}

/**
 * Teacher login gate. Asks the server for the auth status and re-asks whenever the server
 * (re)starts, because a restarted server has forgotten the login.
 */
export function useAuth(serverStatus: ServerStatus | null) {
  const [api, setApi] = useState<AuthApi | null>(null);
  const [view, setView] = useState<AuthView>({ kind: 'loading' });
  const serverKey = serverStatus ? `${serverStatus.state}:${serverStatus.restartCount}` : null;

  useEffect(() => {
    if (serverStatus?.state !== 'running') return;
    let cancelled = false;
    window.examguard
      .getServerConnection()
      .then(async (connection) => {
        if (!connection) throw new Error('The exam server is not running');
        const next = createAuthApi(connection);
        const status = await next.status();
        if (cancelled) return;
        setApi(next);
        setView(toView(status));
      })
      .catch((e: unknown) => {
        if (!cancelled) setView({ kind: 'error', message: String(e) });
      });
    return () => {
      cancelled = true;
    };
    // serverKey changes on every server start/restart.
  }, [serverKey]);

  const logout = useCallback(async () => {
    await api?.logout();
    setView({ kind: 'login' });
  }, [api]);

  return useMemo(
    () => ({
      view:
        serverStatus?.state === 'running' || view.kind === 'error'
          ? view
          : ({ kind: 'loading' } as AuthView),
      api,
      loggedIn: () => setView({ kind: 'home' }),
      logout,
    }),
    [view, api, logout, serverStatus?.state],
  );
}
