import { TimerOffIcon, UnplugIcon } from 'lucide-react';
import type { SessionExit } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '../../components/common/ErrorAlert';
import { StatusCard } from '../../components/student/StatusCard';
import { REASON_TEXT } from './LobbyScreen';

interface Props {
  name: string;
  examTitle: string;
  exit: SessionExit;
  reason: string | undefined;
  onLeave: () => void;
}

/**
 * Shown instead of a locked exam window when the server cannot be reached to say the exam is over,
 * or the session was lost for good. The window is released by main at the same moment.
 */
export function SessionOverScreen({ name, examTitle, exit, reason, onLeave }: Props) {
  const over = exit === 'exam_over';
  return (
    <StatusCard
      icon={over ? TimerOffIcon : UnplugIcon}
      tone={over ? 'warning' : 'destructive'}
      title={over ? 'The exam time is over' : 'This session was closed'}
      name={name}
      examTitle={examTitle}
    >
      {over ? (
        <p role="status">
          Stop working. This computer lost the connection to the teacher. Your answers were saved on
          the teacher's computer up to the moment the connection dropped. You can close ExamGuard
          now and tell your teacher.
        </p>
      ) : (
        <>
          <ErrorAlert>{REASON_TEXT[reason ?? ''] ?? 'The connection was closed.'}</ErrorAlert>
          <Button variant="outline" className="w-fit" onClick={onLeave}>
            Leave this exam
          </Button>
        </>
      )}
    </StatusCard>
  );
}
