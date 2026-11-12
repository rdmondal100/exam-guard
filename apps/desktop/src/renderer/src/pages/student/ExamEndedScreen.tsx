import { FlagIcon } from 'lucide-react';
import { StatusCard } from '../../components/student/StatusCard';

interface Props {
  name: string;
  examTitle: string;
}

/** Shown after the server ends the exam (time is up or the teacher ended it). */
export function ExamEndedScreen({ name, examTitle }: Props) {
  return (
    <StatusCard
      icon={FlagIcon}
      tone="primary"
      title="The exam has ended"
      name={name}
      examTitle={examTitle}
    >
      <p role="status">
        Stop working. You can close ExamGuard now. Your teacher will tell you what happens next.
      </p>
    </StatusCard>
  );
}
