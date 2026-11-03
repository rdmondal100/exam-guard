import { useState } from 'react';
import type { TeacherSettings } from '@examguard/shared';
import type { SettingsApi } from '@/api/settingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { limitsDraft, limitsFromDraft, type RunLimitsDraft } from '@/lib/settingsForm';
import { SettingsCard } from './SettingsCard';
import { FIELD } from './styles';
import { useAction } from './useAction';

interface Props {
  api: SettingsApi;
  settings: TeacherSettings;
  onSaved: (settings: TeacherSettings) => void;
}

const FIELDS: { key: keyof RunLimitsDraft; label: string }[] = [
  { key: 'timeSec', label: 'Time per run (seconds, includes typing into the program)' },
  { key: 'memoryMb', label: 'Memory (MB)' },
  { key: 'outputKb', label: 'Output (KB)' },
  { key: 'processes', label: 'Processes the program may start' },
];

/** The students' code-run limits (M43). They are fixed for an exam when hosting starts. */
export function RunLimitsSection({ api, settings, onSaved }: Props) {
  const [draft, setDraft] = useState(() => limitsDraft(settings.runLimits));
  const { busy, notice, error, run } = useAction();
  const checked = limitsFromDraft(draft);

  const save = () =>
    void run(async () => {
      if (!checked.ok) return null;
      onSaved(await api.update({ runLimits: checked.limits }));
      return 'Run limits saved. They apply from the next exam you host.';
    });

  return (
    <SettingsCard
      title="Code-run limits"
      description="Used from the next exam you host; an exam that is already hosted keeps its limits."
      notice={notice}
      error={error ?? (checked.ok ? null : checked.problems.join(' · '))}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className={FIELD}>
            {f.label}
            <Input
              type="number"
              value={draft[f.key]}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <Button className="self-start" disabled={busy || !checked.ok} onClick={save}>
        Save run limits
      </Button>
    </SettingsCard>
  );
}
