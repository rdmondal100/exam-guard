import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CenteredScreen } from '@/components/common/CenteredScreen';
import { FormField } from '@/components/common/FormField';
import { Spinner } from '@/components/common/Spinner';
import { TeacherApiError, type AuthApi } from '@/api/teacherApi';

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
    <CenteredScreen>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Teacher login</CardTitle>
          <CardDescription>Enter your teacher password to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FormField label="Password">
              <Input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
            {error && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {waitSec > 0 && (
              <p role="status" className="text-sm text-warning">
                Too many attempts. Try again in {waitSec} s.
              </p>
            )}
            <Button type="submit" disabled={busy || waitSec > 0 || password === ''}>
              {busy && <Spinner />}
              Log in
            </Button>
          </form>
        </CardContent>
      </Card>
    </CenteredScreen>
  );
}
