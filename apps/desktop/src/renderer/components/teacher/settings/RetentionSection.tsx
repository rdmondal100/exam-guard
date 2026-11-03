import { useState } from 'react';
import { MAX_RETENTION_DAYS, type TeacherSettings } from '@examguard/shared';
import type { SettingsApi } from '@/api/settingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from './SettingsCard';
import { FIELD } from './styles';
import { useAction } from './useAction';

interface Props {
  api: SettingsApi;
  settings: TeacherSettings;
  onSaved: (settings: TeacherSettings) => void;
}

/**
 * Screenshot retention (M44): keep pictures until the exam is deleted, or delete those older than
 * N days. Applied when saved and at every start; exams that are hosting or running are skipped.
 */
export function RetentionSection({ api, settings, onSaved }: Props) {
  const saved = settings.retention.screenshotDays;
  const [limited, setLimited] = useState(saved !== null);
  const [days, setDays] = useState(String(saved ?? 90));
  const action = useAction();
  const n = Number(days);
  const valid = !limited || (Number.isInteger(n) && n >= 0 && n <= MAX_RETENTION_DAYS);

  const save = () => {
    const screenshotDays = limited ? n : null;
    if (screenshotDays !== null) {
      const ok = window.confirm(
        `Delete the screenshots of ended exams that are older than ${screenshotDays} days? This cannot be undone.`,
      );
      if (!ok) return;
    }
    void action.run(async () => {
      onSaved(await api.update({ retention: { screenshotDays } }));
      if (screenshotDays === null) return 'Saved. Screenshots are kept until the exam is deleted.';
      const { removed } = await api.purgeScreenshots();
      return `Saved. ${removed} old screenshot${removed === 1 ? '' : 's'} deleted; this repeats at every start.`;
    });
  };

  return (
    <SettingsCard
      title="Screenshot retention"
      description="Old screenshots take disk space. The events stay; only their pictures are deleted. Exams that are hosting or running are never touched."
      notice={action.notice}
      error={action.error}
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="retention"
          checked={!limited}
          onChange={() => setLimited(false)}
        />
        Keep screenshots until the exam is deleted
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="retention" checked={limited} onChange={() => setLimited(true)} />
        Delete screenshots older than a number of days
      </label>
      {limited && (
        <label className={FIELD}>
          Days (0 deletes every screenshot of ended exams)
          <Input
            type="number"
            min={0}
            max={MAX_RETENTION_DAYS}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
      )}
      <Button className="self-start" disabled={action.busy || !valid} onClick={save}>
        Save retention
      </Button>
    </SettingsCard>
  );
}
