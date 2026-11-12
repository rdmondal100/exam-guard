import { useState } from 'react';
import { RotateCwIcon } from 'lucide-react';
import type { ServerStatus } from '@examguard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Shown after the server crashed and came back. Dismissing hides it until the next restart. */
export function ServerRestartBanner({ status }: { status: ServerStatus }) {
  const [dismissedAt, setDismissedAt] = useState(0);
  if (status.restartCount === 0 || status.restartCount <= dismissedAt) return null;

  return (
    <Alert variant="warning" className="items-center">
      <RotateCwIcon />
      <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-2">
        <span>Server restarted ({status.restartCount}×). Live data may have a short gap.</span>
        <Button variant="ghost" size="sm" onClick={() => setDismissedAt(status.restartCount)}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  );
}
