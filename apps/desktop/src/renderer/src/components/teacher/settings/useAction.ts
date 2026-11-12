import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Busy flag plus the outcome of the last action of one Settings section. A success message is
 * shown as a toast (M51); an error stays in the section until the next try.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const message = await action();
      setNotice(message);
      if (message) toast.success(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, notice, error, run, setError };
}
