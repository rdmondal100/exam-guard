import { useState, type FormEvent } from 'react';
import {
  DEFAULT_MONITORING,
  type ClassListSummary,
  type ExamSummary,
  type MonitoringSettings,
} from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** What the form hands back. `classListId: null` means no list yet. */
export interface ExamFormValues {
  title: string;
  durationMin: number;
  classListId: string | null;
  monitoring: MonitoringSettings;
}

interface Props {
  /** The exam being edited; absent when creating. */
  exam?: ExamSummary;
  classLists: ClassListSummary[];
  onSubmit: (values: ExamFormValues) => Promise<void>;
  onCancel: () => void;
}

const FIELD = 'flex flex-col gap-1 text-sm font-medium';

/** Title, duration, class list and monitoring settings for one exam. */
export function ExamSettingsForm({ exam, classLists, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(exam?.title ?? '');
  const [durationMin, setDurationMin] = useState(String(exam?.durationMin ?? 90));
  const [classListId, setClassListId] = useState(exam?.classListId ?? '');
  const [monitoring, setMonitoring] = useState(exam?.monitoring ?? DEFAULT_MONITORING);
  const [apps, setApps] = useState(monitoring.highSeverityApps.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const minutes = Number(durationMin);
  const valid =
    title.trim() !== '' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 600 && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        durationMin: minutes,
        classListId: classListId === '' ? null : classListId,
        monitoring: {
          ...monitoring,
          highSeverityApps: apps
            .split(',')
            .map((a) => a.trim())
            .filter((a) => a !== ''),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const setNumber =
    (key: 'screenshotIntervalSec' | 'minScreenshotGapSec' | 'graceSec') => (value: string) => {
      const n = Number(value);
      if (Number.isFinite(n)) setMonitoring({ ...monitoring, [key]: Math.trunc(n) });
    };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-xl flex-col gap-4">
      <h2 className="text-xl font-semibold">{exam ? 'Exam settings' : 'New exam'}</h2>
      <label className={FIELD}>
        Title
        <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={FIELD}>
        Duration (minutes, 1–600)
        <Input
          type="number"
          min={1}
          max={600}
          value={durationMin}
          onChange={(e) => setDurationMin(e.target.value)}
        />
      </label>
      <label className={FIELD}>
        Class list
        <select
          className="h-10 rounded-md border border-border bg-card px-3 text-sm"
          value={classListId}
          onChange={(e) => setClassListId(e.target.value)}
        >
          <option value="">None yet (needed before the exam is ready)</option>
          {classLists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.studentCount})
            </option>
          ))}
        </select>
      </label>

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

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid}>
          {exam ? 'Save' : 'Create exam'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
