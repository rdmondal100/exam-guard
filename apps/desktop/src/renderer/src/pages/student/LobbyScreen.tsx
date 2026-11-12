import { HourglassIcon } from 'lucide-react';
import type { SessionStatus } from '@examguard/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useExamFilesStatus } from '@/hooks/useExamFilesStatus';
import { ErrorAlert } from '../../components/common/ErrorAlert';
import { ExamFilesNotice } from '../../components/student/ExamFilesNotice';
import { StatusCard } from '../../components/student/StatusCard';

interface Props {
  name: string;
  examTitle: string;
  status: SessionStatus;
  error: string | null;
  /** Offered while the link is down, so a stale session cannot trap the student. */
  onLeave: () => void;
}

export const LINK_TEXT: Record<SessionStatus['link'], string> = {
  connecting: 'Connecting to the teacher…',
  connected: 'Connected',
  reconnecting: 'Connection lost. Trying again…',
  failed: 'Disconnected',
};

export const LINK_TONE: Record<SessionStatus['link'], BadgeTone> = {
  connecting: 'warning',
  connected: 'success',
  reconnecting: 'warning',
  failed: 'danger',
};

export const REASON_TEXT: Record<string, string> = {
  replaced: 'This student signed in on another window or computer.',
  unauthorized: 'Your sign-in expired. Leave this exam and join again.',
  protocol_mismatch: "Update ExamGuard to match the teacher's version.",
  fingerprint_mismatch: 'This computer is not the teacher you checked. Tell your invigilator.',
};

/** The lobby: shows the live link while the teacher has not started the exam. */
export function LobbyScreen({ name, examTitle, status, error, onLeave }: Props) {
  const examFiles = useExamFilesStatus();

  return (
    <StatusCard
      icon={HourglassIcon}
      tone="primary"
      title="You are in"
      name={name}
      examTitle={examTitle}
    >
      <Badge role="status" variant={LINK_TONE[status.link]} className="gap-1.5">
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        {LINK_TEXT[status.link]}
      </Badge>
      {(status.reason || error) && (
        <ErrorAlert>
          {error ?? REASON_TEXT[status.reason ?? ''] ?? 'The connection was closed.'}
        </ErrorAlert>
      )}
      <ExamFilesNotice status={examFiles} confirmReady />
      <p className="text-muted-foreground">Waiting for the teacher to start the exam.</p>
      {(status.link === 'reconnecting' || status.link === 'failed') && (
        <Button variant="outline" className="w-fit" onClick={onLeave}>
          Leave this exam
        </Button>
      )}
    </StatusCard>
  );
}
