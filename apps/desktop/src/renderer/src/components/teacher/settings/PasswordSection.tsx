import { useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '@examguard/shared';
import type { SettingsApi } from '@/api/settingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '../../common/FormField';
import { SettingsCard } from './SettingsCard';
import { useAction } from './useAction';

/** Change the teacher password (M43). There is no recovery in Stage 1, so it asks twice. */
export function PasswordSection({ api }: { api: SettingsApi }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, run } = useAction();
  const mismatch = again !== '' && next !== again;
  const valid = current !== '' && next.length >= MIN_PASSWORD_LENGTH && next === again;

  return (
    <SettingsCard
      title="Password"
      description="There is no way to recover a forgotten password, so keep it somewhere safe."
      error={error ?? (mismatch ? 'The new passwords do not match.' : null)}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.changePassword(current, next);
            setCurrent('');
            setNext('');
            setAgain('');
            return 'Password changed.';
          });
        }}
      >
        <FormField label="Current password" className="max-w-sm">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </FormField>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label={`New password (at least ${MIN_PASSWORD_LENGTH} characters)`}>
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </FormField>
          <FormField label="New password again">
            <Input
              type="password"
              autoComplete="new-password"
              aria-invalid={mismatch || undefined}
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </FormField>
        </div>
        <Button type="submit" className="self-start" disabled={busy || !valid}>
          Change password
        </Button>
      </form>
    </SettingsCard>
  );
}
