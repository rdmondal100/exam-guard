import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TeacherApiError, type AuthApi } from '@/lib/teacherApi';

interface Props {
  api: AuthApi;
  onDone: () => void;
}

export function LoginScreen({ api, onDone }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitSec, setWaitSec] = useState(0);

  useEffect(() => {
    if (waitSec <= 0) return;
    const timer = setTimeout(() => setWaitSec((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [waitSec]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      if (err instanceof TeacherApiError && err.code === 'bad_password') {
        setError('Wrong password.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      if (err instanceof TeacherApiError && err.retryAfterSec) setWaitSec(err.retryAfterSec);
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <Card>
        <CardHeader>
          <CardTitle>Teacher login</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <label className="flex flex-col gap-1">
              Password
              <Input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            {waitSec > 0 && <p role="status">Too many attempts. Try again in {waitSec} s.</p>}
            <Button type="submit" disabled={busy || waitSec > 0 || password === ''}>
              Log in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
