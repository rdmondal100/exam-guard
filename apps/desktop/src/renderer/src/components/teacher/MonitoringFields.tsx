import type { MonitoringSettings } from '@examguard/shared';
import { Input } from '@/components/ui/input';
import { FormField } from '../common/FormField';
import { ToggleField } from '../common/ToggleField';

interface Props {
  monitoring: MonitoringSettings;
  /** The high-severity list as typed (comma separated); the caller splits it on save. */
  apps: string;
  onMonitoring: (next: MonitoringSettings) => void;
  onApps: (text: string) => void;
}

/** The monitoring fields of an exam, also used for the defaults in Settings (M43). */
export function MonitoringFields({ monitoring, apps, onMonitoring, onApps }: Props) {
  const setMonitoring = onMonitoring;
  const setApps = onApps;
  const setNumber =
    (key: 'screenshotIntervalSec' | 'minScreenshotGapSec' | 'graceSec') => (value: string) => {
      const n = Number(value);
      if (Number.isFinite(n)) setMonitoring({ ...monitoring, [key]: Math.trunc(n) });
    };

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="sr-only">Monitoring</legend>
      <div className="grid gap-3 md:grid-cols-2">
        <ToggleField
          checked={monitoring.screenshotOnSwitch}
          onCheckedChange={(v) => setMonitoring({ ...monitoring, screenshotOnSwitch: v })}
          label="Screenshot when a student leaves ExamGuard"
        />
        <ToggleField
          checked={monitoring.screenshotOnTitleChange}
          onCheckedChange={(v) => setMonitoring({ ...monitoring, screenshotOnTitleChange: v })}
          label="Screenshot when the window title changes while outside"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <FormField label="Screenshot every (seconds, while outside)">
          <Input
            type="number"
            min={5}
            max={300}
            value={monitoring.screenshotIntervalSec}
            onChange={(e) => setNumber('screenshotIntervalSec')(e.target.value)}
          />
        </FormField>
        <FormField label="At most one screenshot per (seconds)">
          <Input
            type="number"
            min={1}
            max={60}
            value={monitoring.minScreenshotGapSec}
            onChange={(e) => setNumber('minScreenshotGapSec')(e.target.value)}
          />
        </FormField>
        <FormField label="Grace period at time-up (seconds)">
          <Input
            type="number"
            min={0}
            max={600}
            value={monitoring.graceSec}
            onChange={(e) => setNumber('graceSec')(e.target.value)}
          />
        </FormField>
      </div>
      <FormField label="High-severity apps (comma separated)">
        <Input
          value={apps}
          placeholder="chrome.exe, discord.exe"
          onChange={(e) => setApps(e.target.value)}
        />
      </FormField>
    </fieldset>
  );
}
