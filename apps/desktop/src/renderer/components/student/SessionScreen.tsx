import { useEffect, useState } from 'react';
import type { SessionState, SessionStatus } from '@examguard/shared';
import { ExamEndedScreen } from './ExamEndedScreen';
import { ExamScreen } from './ExamScreen';
import { LobbyScreen } from './LobbyScreen';

interface Props {
  name: string;
  examTitle: string;
}

/** Opens the live session and shows the lobby until the exam runs, then the exam. */
export function SessionScreen({ name, examTitle }: Props) {
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

  if (exam?.examState === 'running' && exam.questions && exam.deadline !== null) {
    return (
      <ExamScreen
        name={name}
        examTitle={examTitle}
        questions={exam.questions}
        deadline={exam.deadline}
        status={status}
      />
    );
  }
  if (exam && ['ended', 'grading', 'in_review', 'finalized'].includes(exam.examState)) {
    return <ExamEndedScreen name={name} examTitle={examTitle} />;
  }
  return <LobbyScreen name={name} examTitle={examTitle} status={status} error={error} />;
}
