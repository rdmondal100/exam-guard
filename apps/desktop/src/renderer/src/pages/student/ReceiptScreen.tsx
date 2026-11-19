import { CircleCheckIcon, FileCheckIcon } from 'lucide-react';
import type { Receipt, StudentQuestion } from '@examguard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ShutdownButton } from '../../components/student/ShutdownButton';
import { StatusCard } from '../../components/student/StatusCard';

interface Props {
  name: string;
  examTitle: string;
  receipt: Receipt;
  /** Question list, to say "Question 2" instead of an id. */
  questions: readonly StudentQuestion[] | undefined;
  examEnded: boolean;
  /** The teacher ended the exam while this student was still working. */
  endedByTeacher: boolean;
}

/** Shown once the answers are final: the hash and what was submitted, to keep as proof. */
export function ReceiptScreen({
  name,
  examTitle,
  receipt,
  questions,
  examEnded,
  endedByTeacher,
}: Props) {
  const label = (id: string) => {
    const q = questions?.find((x) => x.id === id);
    return q ? `Question ${q.position}` : id;
  };
  return (
    <StatusCard
      icon={endedByTeacher ? FileCheckIcon : CircleCheckIcon}
      tone={endedByTeacher ? 'warning' : 'success'}
      title={endedByTeacher ? 'The exam was ended by your teacher' : 'Your answers are submitted'}
      name={name}
      examTitle={examTitle}
      width="lg"
    >
      <p>
        {endedByTeacher ? 'Your work was saved at' : 'Submitted at'}{' '}
        <span className="font-medium">{new Date(receipt.submittedAt).toLocaleString()}</span>.
      </p>
      <section
        aria-label="Receipt"
        className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4"
      >
        <h2 className="text-sm font-semibold">Receipt</h2>
        <p className="font-mono text-xs break-all" aria-label="Receipt hash">
          {receipt.hash}
        </p>
        <ul className="flex flex-col gap-1.5">
          {receipt.answers.map((a) => (
            <li key={a.questionId} className="flex items-center gap-3">
              <span className="w-28 shrink-0">{label(a.questionId)}</span>
              <Badge variant="outline" className="w-14 font-mono">
                {a.language}
              </Badge>
              <span className="font-mono text-xs break-all text-muted-foreground">
                {a.sha256.slice(0, 16)}…
              </span>
            </li>
          ))}
        </ul>
      </section>
      <Alert role="status" variant={examEnded ? 'success' : 'info'}>
        <AlertDescription>
          {examEnded
            ? 'The exam has ended. You can close ExamGuard now.'
            : 'You are done. The exam is still running for others, so leave quietly.'}
        </AlertDescription>
      </Alert>
      <ShutdownButton />
    </StatusCard>
  );
}
