import { useEffect, useState } from 'react';
import type { DiscoveredHost } from '@examguard/shared';

/** Teachers found over mDNS while the Find exam screen is open. */
export function useDiscovery(): DiscoveredHost[] {
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);

  useEffect(() => {
    const unsubscribe = window.examguard.onDiscoveryHosts(setHosts);
    window.examguard.startDiscovery().then(setHosts, () => undefined);
    return () => {
      unsubscribe();
      void window.examguard.stopDiscovery();
    };
  }, []);

  return hosts;
}
