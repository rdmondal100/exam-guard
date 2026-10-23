import { useEffect, useState } from 'react';
import type { SessionState, SessionStatus } from '@examguard/shared';
import { useRestoreAnswers } from '@/lib/restoreAnswers';
import { ExamEndedScreen } from './ExamEndedScreen';
import { ExamScreen } from './ExamScreen';
import { LobbyScreen } from './LobbyScreen';
import { ReceiptScreen } from './ReceiptScreen';
import { RestoringScreen } from './RestoringScreen';

interface Props {
  name: string;
  examTitle: string;
  /** Forget this exam on this computer and go back to finding one. */
  onLeave: () => void;
}

/** Opens the live session and shows the lobby until the exam runs, then the exam. */
export function SessionScreen({ name, examTitle, onLeave }: Props) {
  const [status, setStatus] = useState<SessionStatus>({ link: 'connecting', offsetMs: null });
  const [exam, setExam] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offStatus = window.examguard.onSessionStatus(setStatus);
    const offExam = window.examguard.onSessionExam(setExam);
    window.examguard.startSession().catch(() => setError('Could not start the live connection.'));
    return () => {
      offStatus();
      offExam();
    };
  }, []);

  const examOpen =
    exam?.examState === 'running' && !!exam.questions && exam.deadline !== null && !exam.receipt;
  const restore = useRestoreAnswers(examOpen);

  if (examOpen && restore.state.name !== 'ready') {
    return (
      <RestoringScreen
        error={restore.state.name === 'failed' ? restore.state.message : null}
        onRetry={restore.retry}
      />
    );
  }
  if (exam?.receipt) {
    return (
      <ReceiptScreen
        name={name}
        examTitle={examTitle}
        receipt={exam.receipt}
        questions={exam.questions}
        examEnded={exam.examState !== 'running'}
        endedByTeacher={exam.studentState === 'ended_by_teacher'}
      />
    );
  }
  if (exam?.examState === 'running' && exam.questions && exam.deadline !== null) {
    return (
      <ExamScreen
        name={name}
        examTitle={examTitle}
        questions={exam.questions}
        deadline={exam.deadline}
        terminalOn={exam.terminal.enabled}
        filesOn={exam.filesEnabled}
        status={status}
      />
    );
  }
  if (exam && ['ended', 'grading', 'in_review', 'finalized'].includes(exam.examState)) {
    return <ExamEndedScreen name={name} examTitle={examTitle} />;
  }
  return (
    <LobbyScreen
      name={name}
      examTitle={examTitle}
      status={status}
      error={error}
      onLeave={onLeave}
    />
  );
}
