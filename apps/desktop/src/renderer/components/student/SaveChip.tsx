import type { AnswerStatus } from '@examguard/shared';

interface Props {
  status: AnswerStatus;
  /** False while the link to the teacher's PC is down. */
  online: boolean;
}

/** Tells the student whether their work has reached the teacher's PC. */
export function SaveChip({ status, online }: Props) {
  const waiting = status.pending > 0;
  const text = waiting
    ? online
      ? 'Saving…'
      : `${status.pending} change${status.pending === 1 ? '' : 's'} not sent yet`
    : status.lastAckAt
      ? 'All changes saved'
      : 'Autosave on';
  return (
    <span
      role="status"
      className={`rounded-md px-3 py-1 text-sm ${
        waiting && !online ? 'bg-amber-100 text-amber-900' : 'bg-black/5'
      }`}
    >
      {text}
    </span>
  );
}
