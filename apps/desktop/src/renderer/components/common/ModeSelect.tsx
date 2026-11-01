import type { AppMode } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const OPTIONS: Record<AppMode, { title: string; text: string }> = {
  teacher: {
    title: 'Teacher',
    text: 'Host the exam on this PC, monitor students live and grade with AI.',
  },
  student: {
    title: 'Student',
    text: 'Join an exam from your teacher and take it in a fullscreen window.',
  },
};

interface Props {
  allowed: AppMode[];
  onChoose: (mode: AppMode) => void;
}

export function ModeSelect({ allowed, onChoose }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 p-8">
      <header>
        <h1 className="text-3xl font-semibold">Welcome to ExamGuard AI</h1>
        <p className="mt-2 text-muted">How will you use this computer?</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {allowed.map((mode) => (
          <Card key={mode}>
            <CardHeader>
              <CardTitle>{OPTIONS[mode].title} mode</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p>{OPTIONS[mode].text}</p>
              <Button onClick={() => onChoose(mode)}>Use {OPTIONS[mode].title} mode</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
