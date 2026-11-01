import { useCallback, useEffect, useState } from 'react';
import type { AgentServiceStatus } from '@examguard/shared';

/** The agent service state, re-read every `intervalMs`. `null` until the first answer. */
export function useAgentStatus(intervalMs: number): {
  status: AgentServiceStatus | null;
  refresh: () => void;
} {
  const [status, setStatus] = useState<AgentServiceStatus | null>(null);
  const refresh = useCallback(() => {
    window.examguard.agentStatus().then(setStatus, () => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { status, refresh };
}
