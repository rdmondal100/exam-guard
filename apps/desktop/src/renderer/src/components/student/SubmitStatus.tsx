import { CircleAlertIcon, LoaderCircleIcon, RotateCcwIcon, WifiOffIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Props {
  /** A Submit is waiting for the server's answer. */
  busy: boolean;
  /** Why the last Submit did not go through, in the student's words. */
  error: string | null;
  linkOk: boolean;
  onRetry: () => void;
}

/**
 * The Submit's state in the toolbar (M64), so it stays visible after the dialog is closed: queued
 * while offline, sending, or refused with a retry.
 */
export function SubmitStatus({ busy, error, linkOk, onRetry }: Props) {
  if (busy) {
    return linkOk ? (
      <Badge role="status" variant="info" className="h-7 gap-1.5 px-2.5">
        <LoaderCircleIcon className="animate-spin" aria-hidden />
        Submitting…
      </Badge>
    ) : (
      <Badge role="status" variant="warning" className="h-7 gap-1.5 px-2.5">
        <WifiOffIcon aria-hidden />
        Submit waiting for the connection
      </Badge>
    );
  }
  if (!error) return null;
  return (
    <div role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
      <CircleAlertIcon className="size-4" aria-hidden />
      <span className="max-w-64 truncate" title={error}>
        Not submitted: {error}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        <RotateCcwIcon />
        Try again
      </Button>
    </div>
  );
}
