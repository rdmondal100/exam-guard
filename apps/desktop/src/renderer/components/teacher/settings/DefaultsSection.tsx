import { useState } from 'react';
import type { TeacherSettings } from '@examguard/shared';
import type { SettingsApi } from '@/api/settingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { splitApps } from '@/lib/appList';
import { MonitoringFields } from '../MonitoringFields';
import { SettingsCard } from './SettingsCard';
import { FIELD } from './styles';
import { useAction } from './useAction';

interface Props {
  api: SettingsApi;
  settings: TeacherSettings;
  onSaved: (settings: TeacherSettings) => void;
}

/** What a new exam starts with (M43). Existing exams keep their own settings. */
export function DefaultsSection({ api, settings, onSaved }: Props) {
  const [duration, setDuration] = useState(String(settings.defaults.durationMin));
  const [monitoring, setMonitoring] = useState(settings.defaults.monitoring);
  const [apps, setApps] = useState(settings.defaults.monitoring.highSeverityApps.join(', '));
  const { busy, notice, error, run } = useAction();
  const minutes = Number(duration);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 600;

  const save = () =>
    void run(async () => {
      onSaved(
        await api.update({
          defaults: {
            durationMin: minutes,
            monitoring: { ...monitoring, highSeverityApps: splitApps(apps) },
          },
        }),
      );
      return 'Defaults saved.';
    });

  return (
    <SettingsCard
      title="New exam defaults"
      description="A new exam starts with these. Changing them does not change existing exams."
      notice={notice}
      error={error}
    >
      <label className={FIELD}>
        Duration (minutes, 1–600)
        <Input
          type="number"
          min={1}
          max={600}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </label>
      <MonitoringFields
        monitoring={monitoring}
        apps={apps}
        onMonitoring={setMonitoring}
        onApps={setApps}
      />
      <Button className="self-start" disabled={busy || !valid} onClick={save}>
        Save defaults
      </Button>
    </SettingsCard>
  );
}
