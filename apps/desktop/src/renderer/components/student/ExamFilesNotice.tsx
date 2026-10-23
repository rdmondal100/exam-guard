import type { ExamFilesStatus } from '@examguard/shared';

interface Props {
  status: ExamFilesStatus;
  /** In the lobby: also say when everything is downloaded. */
  confirmReady?: boolean;
}

/** Progress, trouble and "ready" for the teacher's exam files. Nothing to show means nothing is drawn. */
export function ExamFilesNotice({ status, confirmReady = false }: Props) {
  if (status.state === 'syncing') {
    return (
      <p role="status" className="rounded-md bg-blue-100 px-3 py-1 text-sm text-blue-900">
        Getting your exam files ({status.done} of {status.total})…
      </p>
    );
  }
  if (status.state === 'failed') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-md bg-red-100 px-3 py-1 text-sm text-red-900"
      >
        <span>
          Some exam files could not be downloaded
          {status.message ? `: ${status.message}` : '.'}
        </span>
        <button
          type="button"
          onClick={() => void window.examguard.retryExamFiles()}
          className="rounded-md border border-red-900 px-2 py-0.5"
        >
          Try again
        </button>
      </div>
    );
  }
  if (status.state === 'done' && status.message) {
    return (
      <p role="status" className="rounded-md bg-amber-100 px-3 py-1 text-sm text-amber-900">
        Some exam files were skipped: {status.message}
      </p>
    );
  }
  if (status.state === 'done' && status.total > 0 && confirmReady) {
    return (
      <p role="status" className="rounded-md bg-green-100 px-3 py-1 text-sm text-green-900">
        Your exam files are ready ({status.total}).
      </p>
    );
  }
  return null;
}
