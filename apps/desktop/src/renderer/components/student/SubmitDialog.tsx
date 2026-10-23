import { Button } from '@/components/ui/button';

interface Props {
  answered: number;
  total: number;
  /** Saves main has not got an ack for yet; they are sent before the submit. */
  unsent: number;
  linkOk: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks once before the answers become final. Hand-made: a native confirm would fight the lock. */
export function SubmitDialog({
  answered,
  total,
  unsent,
  linkOk,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const unanswered = total - answered;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Submit your exam"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-md bg-card p-5 shadow-lg">
        <h2 className="text-lg font-semibold">Submit your exam?</h2>
        <p>
          You have answered {answered} of {total} question{total === 1 ? '' : 's'}.
        </p>
        {unanswered > 0 && (
          <p className="rounded-md bg-amber-100 p-2 text-sm text-amber-900">
            {unanswered} question{unanswered === 1 ? ' has' : 's have'} no answer yet.
          </p>
        )}
        <p className="text-sm">
          After you submit you cannot change your answers. The language shown as “Will submit” on
          each code question is the one that counts.
        </p>
        {busy && !linkOk && (
          <p role="status" className="text-sm text-amber-900">
            Waiting for the connection. Your answers are submitted as soon as it is back. Keep this
            window open.
          </p>
        )}
        {busy && linkOk && (
          <p role="status" className="text-sm text-muted">
            Submitting…
            {unsent > 0 ? ` (${unsent} change${unsent === 1 ? '' : 's'} still sending)` : ''}
          </p>
        )}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy && linkOk}>
            {busy ? 'Hide' : 'Keep working'}
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            Submit exam
          </Button>
        </div>
      </div>
    </div>
  );
}
