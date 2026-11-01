interface Props {
  name: string;
  examTitle: string;
}

/** Shown after the server ends the exam (time is up or the teacher ended it). */
export function ExamEndedScreen({ name, examTitle }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-8">
      <h1 className="text-3xl font-semibold">The exam has ended</h1>
      <p className="text-lg">{name}</p>
      <p className="text-muted">{examTitle}</p>
      <p role="status">
        Stop working. You can close ExamGuard now. Your teacher will tell you what happens next.
      </p>
    </main>
  );
}
