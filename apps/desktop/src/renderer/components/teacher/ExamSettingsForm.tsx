import { useState, type FormEvent } from 'react';
import {
  DEFAULT_EXAM_DURATION_MIN,
  DEFAULT_MONITORING,
  type ClassListSummary,
  type TeacherSettings,
  type ExamSummary,
  type MonitoringSettings,
} from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { splitApps } from '@/lib/appList';
import { MonitoringFields } from './MonitoringFields';

/** What the form hands back. `classListId: null` means no list yet. */
export interface ExamFormValues {
  title: string;
  durationMin: number;
  classListId: string | null;
  monitoring: MonitoringSettings;
  filesEnabled: boolean;
}

interface Props {
  /** The exam being edited; absent when creating. */
  exam?: ExamSummary;
  classLists: ClassListSummary[];
  /** The teacher's defaults from Settings (M43) for a new exam. */
  defaults?: TeacherSettings['defaults'] | undefined;
  onSubmit: (values: ExamFormValues) => Promise<void>;
  onCancel: () => void;
}

const FIELD = 'flex flex-col gap-1 text-sm font-medium';

/** Title, duration, class list and monitoring settings for one exam. */
export function ExamSettingsForm({ exam, classLists, defaults, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(exam?.title ?? '');
  const [durationMin, setDurationMin] = useState(
    String(exam?.durationMin ?? defaults?.durationMin ?? DEFAULT_EXAM_DURATION_MIN),
  );
  const [classListId, setClassListId] = useState(exam?.classListId ?? '');
  const [monitoring, setMonitoring] = useState(
    exam?.monitoring ?? defaults?.monitoring ?? DEFAULT_MONITORING,
  );
  const [filesEnabled, setFilesEnabled] = useState(exam?.filesEnabled ?? true);
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
        filesEnabled,
        monitoring: {
          ...monitoring,
          highSeverityApps: splitApps(apps),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
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

      <fieldset className="flex flex-col gap-2 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Students' tools</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filesEnabled}
            onChange={(e) => setFilesEnabled(e.target.checked)}
          />
          Files panel (students can create, read and write files in their project folder)
        </label>
        <p className="text-xs text-muted">
          Files stay on the student's PC and are not submitted. The exam terminal is switched on and
          off while the exam runs.
        </p>
      </fieldset>

      <MonitoringFields
        monitoring={monitoring}
        apps={apps}
        onMonitoring={setMonitoring}
        onApps={setApps}
      />

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
