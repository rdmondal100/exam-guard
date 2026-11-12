import { TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '../common/Spinner';

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

/**
 * Asks once before the answers become final (an in-page dialog: a native confirm would fight the
 * lock). Mounted only while asking; Esc counts as "Keep working" unless the submit is underway.
 */
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
  const canCancel = !(busy && linkOk);
  return (
    <AlertDialog open onOpenChange={(open) => !open && canCancel && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Submit your exam?</AlertDialogTitle>
          <AlertDialogDescription>
            You have answered {answered} of {total} question{total === 1 ? '' : 's'}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {unanswered > 0 && (
          <Alert variant="warning" role="status">
            <TriangleAlertIcon />
            <AlertDescription>
              {unanswered} question{unanswered === 1 ? ' has' : 's have'} no answer yet.
            </AlertDescription>
          </Alert>
        )}
        <p className="text-sm">
          After you submit you cannot change your answers. The language shown as “Will submit” on
          each code question is the one that counts.
        </p>
        {busy && !linkOk && (
          <p role="status" className="text-sm text-warning">
            Waiting for the connection. Your answers are submitted as soon as it is back. Keep this
            window open.
          </p>
        )}
        {busy && linkOk && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Submitting…
            {unsent > 0 ? ` (${unsent} change${unsent === 1 ? '' : 's'} still sending)` : ''}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={!canCancel}>
            {busy ? 'Hide' : 'Keep working'}
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            Submit exam
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
