/** Placeholder lobby. The real lobby (live connection, roster) arrives in M12. */
export function WaitingScreen({ name, examTitle }: { name: string; examTitle: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-8">
      <h1 className="text-3xl font-semibold">You are in</h1>
      <p className="text-lg">{name}</p>
      <p className="text-muted">{examTitle}</p>
      <p className="text-sm text-muted">Waiting for the teacher to start the exam.</p>
    </main>
  );
}
