import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  onAccepted: () => void;
  onBack: () => void;
}

/** What ExamGuard observes during the exam. Accepting tells the server and enters the lobby. */
export function MonitoringNotice({ onAccepted, onBack }: Props) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.examguard.confirmJoin();
      if (result.ok) return onAccepted();
      setError(result.message);
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-8">
      <h1 className="text-3xl font-semibold">Monitoring notice</h1>
      <div className="space-y-3 text-sm leading-relaxed">
        <p>While this exam is running, ExamGuard records the following on this computer:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Which application is in front, its window title, and when you switch away.</li>
          <li>Applications you open during the exam.</li>
          <li>
            Screenshots when you leave the exam window, and about every 20 seconds while away.
          </li>
          <li>Small preview images of your exam screen that the teacher can watch live.</li>
          <li>Your answers, saved as you type, and any code you run.</li>
        </ul>
        <p>
          ExamGuard does not block applications or websites. Your teacher reviews this record and
          decides what it means.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>I have read this notice and I agree to be monitored during the exam.</span>
      </label>
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={() => void accept()} disabled={!checked || busy}>
          {busy ? 'Please wait…' : 'Accept and continue'}
        </Button>
      </div>
    </main>
  );
}
