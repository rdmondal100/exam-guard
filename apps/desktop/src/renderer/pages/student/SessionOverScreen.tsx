import type { SessionExit } from '@examguard/shared';
import { Button } from '@/components/ui/button';
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
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-8">
      <h1 className="text-3xl font-semibold">
        {exit === 'exam_over' ? 'The exam time is over' : 'This session was closed'}
      </h1>
      <p className="text-lg">{name}</p>
      <p className="text-muted">{examTitle}</p>
      {exit === 'exam_over' ? (
        <p role="status">
          Stop working. This computer lost the connection to the teacher. Your answers were saved on
          the teacher's computer up to the moment the connection dropped. You can close ExamGuard
          now and tell your teacher.
        </p>
      ) : (
        <>
          <p role="alert" className="text-red-700">
            {REASON_TEXT[reason ?? ''] ?? 'The connection was closed.'}
          </p>
          <Button variant="outline" className="w-fit" onClick={onLeave}>
            Leave this exam
          </Button>
        </>
      )}
    </main>
  );
}
