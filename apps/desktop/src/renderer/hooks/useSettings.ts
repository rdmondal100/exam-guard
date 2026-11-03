import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ServerConnection, TeacherSettings } from '@examguard/shared';
import { createSettingsApi, type SettingsApi } from '../api/settingsApi';

export interface SettingsView {
  api: SettingsApi | null;
  settings: TeacherSettings | null;
  error: string | null;
  reload(): Promise<void>;
  /** Shows settings the caller already has (the answer of a save). */
  set(settings: TeacherSettings): void;
}

/** The teacher's settings (M43), loaded once the server connection is known. */
export function useSettings(): SettingsView {
  const [connection, setConnection] = useState<ServerConnection | null>(null);
  const [settings, setSettings] = useState<TeacherSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = useMemo(() => (connection ? createSettingsApi(connection) : null), [connection]);

  useEffect(() => {
    let cancelled = false;
    void window.examguard.getServerConnection().then((next) => {
      if (!cancelled) setConnection(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      setSettings(await api.get());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { api, settings, error, reload, set: setSettings };
}
