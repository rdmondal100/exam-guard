import type { MonitoringSettings } from '@examguard/shared';
import { Input } from '@/components/ui/input';

interface Props {
  monitoring: MonitoringSettings;
  /** The high-severity list as typed (comma separated); the caller splits it on save. */
  apps: string;
  onMonitoring: (next: MonitoringSettings) => void;
  onApps: (text: string) => void;
}

const FIELD = 'flex flex-col gap-1 text-sm font-medium';

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
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium">Monitoring</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={monitoring.screenshotOnSwitch}
          onChange={(e) => setMonitoring({ ...monitoring, screenshotOnSwitch: e.target.checked })}
        />
        Screenshot when a student leaves ExamGuard
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={monitoring.screenshotOnTitleChange}
          onChange={(e) =>
            setMonitoring({ ...monitoring, screenshotOnTitleChange: e.target.checked })
          }
        />
        Screenshot when the window title changes while outside
      </label>
      <label className={FIELD}>
        Screenshot every (seconds, while outside)
        <Input
          type="number"
          min={5}
          max={300}
          value={monitoring.screenshotIntervalSec}
          onChange={(e) => setNumber('screenshotIntervalSec')(e.target.value)}
        />
      </label>
      <label className={FIELD}>
        At most one screenshot per (seconds)
        <Input
          type="number"
          min={1}
          max={60}
          value={monitoring.minScreenshotGapSec}
          onChange={(e) => setNumber('minScreenshotGapSec')(e.target.value)}
        />
      </label>
      <label className={FIELD}>
        High-severity apps (comma separated)
        <Input
          value={apps}
          placeholder="chrome.exe, discord.exe"
          onChange={(e) => setApps(e.target.value)}
        />
      </label>
      <label className={FIELD}>
        Grace period at time-up (seconds)
        <Input
          type="number"
          min={0}
          max={600}
          value={monitoring.graceSec}
          onChange={(e) => setNumber('graceSec')(e.target.value)}
        />
      </label>
    </fieldset>
  );
}
