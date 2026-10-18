import { useEffect, useState } from 'react';
import type { ServerStatus } from '@examguard/shared';

/** Live server status from main. `null` until the first value arrives. */
export function useServerStatus(): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    const unsubscribe = window.examguard.onServerStatus(setStatus);
    window.examguard.getServerStatus().then(setStatus, () => undefined);
    return unsubscribe;
  }, []);

  return status;
}
