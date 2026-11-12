import { useEffect, useState } from 'react';
import type { JoinResult } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CenteredScreen } from '../common/CenteredScreen';
import { ErrorAlert } from '../common/ErrorAlert';
import { FormField } from '../common/FormField';
import { Spinner } from '../common/Spinner';

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
  const [waitSec, setWaitSec] = useState(0);

  useEffect(() => {
    if (waitSec <= 0) return;
    const timer = setTimeout(() => setWaitSec((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [waitSec]);

  const pinValid = /^\d{6}$/.test(pin);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (waitSec > 0 || !pinValid || studentCode.trim() === '') return;
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
      setError(result.message);
      setWaitSec(result.retryAfterSec ?? 0);
    } catch {
      setError('Something went wrong while joining. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredScreen>
      <Card>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
          <CardHeader>
            <CardTitle className="text-2xl">Join exam</CardTitle>
            <CardDescription>{examTitle}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Student ID">
              <Input
                autoFocus
                autoComplete="off"
                value={studentCode}
                onChange={(e) => setStudentCode(e.target.value)}
              />
            </FormField>
            <FormField label="Exam PIN (6 digits, shown on the teacher screen)">
              <Input
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                className="h-11 text-center font-mono text-lg tracking-[0.4em]"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </FormField>
            {error && <ErrorAlert>{error}</ErrorAlert>}
            {waitSec > 0 && (
              <p role="status" className="text-sm text-warning">
                Try again in {waitSec} s.
              </p>
            )}
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
              Back
            </Button>
            <Button
              type="submit"
              disabled={busy || waitSec > 0 || !pinValid || studentCode.trim() === ''}
            >
              {busy && <Spinner />}
              {busy ? 'Joining…' : 'Join'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </CenteredScreen>
  );
}
