/**
 * Covers the exam while the student is locked (M24: the monitoring agent on this PC stopped
 * answering). Only the teacher can unlock. The timer keeps running and the answers typed so far
 * are already saved, so nothing is lost while it waits.
 */
export function ExamLockedOverlay() {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exam-locked-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-8"
    >
      <div className="flex max-w-md flex-col gap-3 text-center">
        <h1 id="exam-locked-title" className="text-3xl font-semibold text-red-700">
          Your exam is locked
        </h1>
        <p>
          The monitoring agent on this computer stopped answering, so the exam was paused for you.
          Raise your hand: only the teacher can unlock it.
        </p>
        <p className="text-sm text-muted">
          Your answers so far are saved. The exam time keeps running.
        </p>
      </div>
    </div>
  );
}
