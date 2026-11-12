import { useState } from 'react';
import { MAX_RETENTION_DAYS, type TeacherSettings } from '@examguard/shared';
import type { SettingsApi } from '@/api/settingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useConfirm } from '@/hooks/useConfirm';
import { FormField } from '../../common/FormField';
import { SettingsCard } from './SettingsCard';
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
  const confirm = useConfirm();
  const n = Number(days);
  const valid = !limited || (Number.isInteger(n) && n >= 0 && n <= MAX_RETENTION_DAYS);

  const save = async () => {
    const screenshotDays = limited ? n : null;
    if (screenshotDays !== null) {
      const ok = await confirm({
        title: `Delete the screenshots of ended exams that are older than ${screenshotDays} days?`,
        description: 'This cannot be undone.',
        confirmLabel: 'Delete and save',
        destructive: true,
      });
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
      error={action.error}
      footer={
        <Button disabled={action.busy || !valid} onClick={() => void save()}>
          Save retention
        </Button>
      }
    >
      <RadioGroup
        aria-label="Retention"
        value={limited ? 'limited' : 'keep'}
        onValueChange={(v) => setLimited(v === 'limited')}
      >
        <div className="flex items-center gap-3">
          <RadioGroupItem id="retention-keep" value="keep" />
          <Label htmlFor="retention-keep" className="font-normal">
            Keep screenshots until the exam is deleted
          </Label>
        </div>
        <div className="flex items-center gap-3">
          <RadioGroupItem id="retention-limited" value="limited" />
          <Label htmlFor="retention-limited" className="font-normal">
            Delete screenshots older than a number of days
          </Label>
        </div>
      </RadioGroup>
      {limited && (
        <FormField label="Days (0 deletes every screenshot of ended exams)" className="max-w-sm">
          <Input
            type="number"
            min={0}
            max={MAX_RETENTION_DAYS}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </FormField>
      )}
    </SettingsCard>
  );
}
