import { Button } from '@/components/ui/button';

interface Props {
  /** `null` while loading; the reason when it failed. */
  error: string | null;
  onRetry: () => void;
}

/** Shown between a restart and the exam screen while the saved answers are loaded. */
export function RestoringScreen({ error, onRetry }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-8">
      <h1 className="text-2xl font-semibold">Restoring your work…</h1>
      {error ? (
        <>
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
          <p className="text-sm text-muted">
            Your answers are safe on the teacher&apos;s computer. The exam opens once they load, so
            nothing you type can replace them.
          </p>
          <Button className="w-fit" onClick={onRetry}>
            Try again
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted">Loading what you saved before the restart.</p>
      )}
    </main>
  );
}
