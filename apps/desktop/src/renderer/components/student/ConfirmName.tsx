import { Button } from '@/components/ui/button';

interface Props {
  name: string;
  examTitle: string;
  onYes: () => void;
  onNo: () => void;
}

/** "Is this you?" step, so a mistyped ID is caught before the notice. */
export function ConfirmName({ name, examTitle, onYes, onNo }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Is this you?</h1>
      <div className="rounded-md border border-border p-4">
        <p className="text-2xl font-medium">{name}</p>
        <p className="text-muted">{examTitle}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onNo}>
          No, go back
        </Button>
        <Button onClick={onYes}>Yes, that is me</Button>
      </div>
    </main>
  );
}
