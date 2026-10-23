import type { Receipt, StudentQuestion } from '@examguard/shared';

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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">
        {endedByTeacher ? 'The exam was ended by your teacher' : 'Your answers are submitted'}
      </h1>
      <p className="text-lg">{name}</p>
      <p className="text-muted">{examTitle}</p>
      <p>
        {endedByTeacher ? 'Your work was saved at' : 'Submitted at'}{' '}
        {new Date(receipt.submittedAt).toLocaleString()}.
      </p>
      <section aria-label="Receipt" className="flex flex-col gap-2 rounded-md bg-black/5 p-4">
        <h2 className="text-sm font-semibold">Receipt</h2>
        <p className="break-all font-mono text-sm" aria-label="Receipt hash">
          {receipt.hash}
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {receipt.answers.map((a) => (
            <li key={a.questionId} className="flex gap-2">
              <span className="w-28 shrink-0">{label(a.questionId)}</span>
              <span className="w-12 shrink-0 font-mono">{a.language}</span>
              <span className="break-all font-mono text-muted">{a.sha256.slice(0, 16)}…</span>
            </li>
          ))}
        </ul>
      </section>
      <p role="status">
        {examEnded
          ? 'The exam has ended. You can close ExamGuard now.'
          : 'You are done. Wait for your teacher before you close ExamGuard; the exam is still running for others.'}
      </p>
    </main>
  );
}
