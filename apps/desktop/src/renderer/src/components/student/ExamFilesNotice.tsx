import { CircleCheckIcon, DownloadIcon, TriangleAlertIcon, XCircleIcon } from 'lucide-react';
import type { ExamFilesStatus } from '@examguard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface Props {
  status: ExamFilesStatus;
  /** In the lobby: also say when everything is downloaded. */
  confirmReady?: boolean;
  /** The exam window shows it as a full-width strip. */
  className?: string;
}

/** Progress, trouble and "ready" for the teacher's exam files. Nothing to show means nothing is drawn. */
export function ExamFilesNotice({ status, confirmReady = false, className }: Props) {
  if (status.state === 'syncing') {
    return (
      <Alert role="status" variant="info" className={className}>
        <DownloadIcon />
        <AlertDescription>
          Getting your exam files ({status.done} of {status.total})…
        </AlertDescription>
      </Alert>
    );
  }
  if (status.state === 'failed') {
    return (
      <Alert variant="destructive" className={className}>
        <XCircleIcon />
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>
            Some exam files could not be downloaded
            {status.message ? `: ${status.message}` : '.'}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline-destructive"
            onClick={() => void window.examguard.retryExamFiles()}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (status.state === 'done' && status.message) {
    return (
      <Alert role="status" variant="warning" className={className}>
        <TriangleAlertIcon />
        <AlertDescription>Some exam files were skipped: {status.message}</AlertDescription>
      </Alert>
    );
  }
  if (status.state === 'done' && status.total > 0 && confirmReady) {
    return (
      <Alert role="status" variant="success" className={className}>
        <CircleCheckIcon />
        <AlertDescription>Your exam files are ready ({status.total}).</AlertDescription>
      </Alert>
    );
  }
  return null;
}
