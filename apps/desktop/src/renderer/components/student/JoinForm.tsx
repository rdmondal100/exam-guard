import { useState } from 'react';
import type { JoinResult } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Joined = Extract<JoinResult, { ok: true }>;

interface Props {
  address: string;
  port: number;
  fingerprint: string;
  examTitle: string;
  onJoined: (joined: Joined) => void;
  onBack: () => void;
}

/** Student ID + PIN. The result of the join (name, exam title) goes to the next screen. */
export function JoinForm({ address, port, fingerprint, examTitle, onJoined, onBack }: Props) {
  const [studentCode, setStudentCode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pinValid = /^\d{6}$/.test(pin);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pinValid || studentCode.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.examguard.joinExam({
        address,
        port,
        fingerprint,
        studentCode: studentCode.trim(),
        pin,
      });
      if (result.ok) return onJoined(result);
      setError(
        result.retryAfterSec
          ? `${result.message} (try again in ${result.retryAfterSec} s)`
          : result.message,
      );
    } catch {
      setError('Something went wrong while joining. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-3xl font-semibold">Join exam</h1>
        <p className="mt-1 text-muted">{examTitle}</p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="student-code">
            Student ID
          </label>
          <Input
            id="student-code"
            autoFocus
            autoComplete="off"
            value={studentCode}
            onChange={(e) => setStudentCode(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="exam-pin">
            Exam PIN (6 digits, shown on the teacher screen)
          </label>
          <Input
            id="exam-pin"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            className="font-mono tracking-widest"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button type="submit" disabled={busy || !pinValid || studentCode.trim() === ''}>
            {busy ? 'Joining…' : 'Join'}
          </Button>
        </div>
      </form>
    </main>
  );
}
