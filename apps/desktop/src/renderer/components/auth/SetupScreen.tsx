import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { AuthApi } from '@/lib/teacherApi';

interface Props {
  api: AuthApi;
  onDone: () => void;
}

/** First run: choose the teacher password. There is no recovery in Stage 1. */
export function SetupScreen({ api, onDone }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setup(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <Card>
        <CardHeader>
          <CardTitle>Set a teacher password</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <p>
              You will enter this every time you open ExamGuard. It cannot be recovered, so keep it
              safe.
            </p>
            <label className="flex flex-col gap-1">
              Password
              <Input
                type="password"
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              Confirm password
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              Set password
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
