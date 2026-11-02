import { useState } from 'react';
import type { ServerStatus } from '@examguard/shared';

/** Shown after the server crashed and came back. Dismissing hides it until the next restart. */
export function ServerRestartBanner({ status }: { status: ServerStatus }) {
  const [dismissedAt, setDismissedAt] = useState(0);
  if (status.restartCount === 0 || status.restartCount <= dismissedAt) return null;

  return (
    <div
      role="alert"
      className="mt-6 flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <span>Server restarted ({status.restartCount}×). Live data may have a short gap.</span>
      <button className="underline" onClick={() => setDismissedAt(status.restartCount)}>
        Dismiss
      </button>
    </div>
  );
}
