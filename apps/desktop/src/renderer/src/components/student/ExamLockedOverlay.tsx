import { LockIcon } from 'lucide-react';

/**
 * Covers the exam while the teacher has locked the student (M35). Only the teacher can unlock, so
 * this is a plain overlay, not a dismissible dialog. The timer keeps running and the answers typed
 * so far are already saved, so nothing is lost while it waits.
 */
export function ExamLockedOverlay() {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exam-locked-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-8 backdrop-blur-sm"
    >
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-destructive/12 text-destructive">
          <LockIcon className="size-8" aria-hidden />
        </div>
        <h1 id="exam-locked-title" className="text-3xl font-semibold text-destructive">
          Your exam is locked
        </h1>
        <p className="text-lg">
          Your teacher locked your screen. Wait for them, or raise your hand.
        </p>
        <p className="text-sm text-muted-foreground">
          Your answers so far are saved. The exam time keeps running.
        </p>
      </div>
    </div>
  );
}
