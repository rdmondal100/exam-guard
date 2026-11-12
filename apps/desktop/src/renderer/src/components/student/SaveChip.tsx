import { CloudCheckIcon, CloudOffIcon, Loader2Icon } from 'lucide-react';
import type { AnswerStatus } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';

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
  const Icon = waiting ? (online ? Loader2Icon : CloudOffIcon) : CloudCheckIcon;
  return (
    <Badge
      role="status"
      variant={waiting && !online ? 'warning' : 'neutral'}
      className="h-7 px-2.5"
    >
      <Icon className={waiting && online ? 'animate-spin' : undefined} aria-hidden />
      {text}
    </Badge>
  );
}
