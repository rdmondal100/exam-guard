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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { splitApps } from '@/lib/appList';
import { ErrorAlert } from '../common/ErrorAlert';
import { FormField } from '../common/FormField';
import { OptionSelect } from '../common/OptionSelect';
import { Spinner } from '../common/Spinner';
import { ToggleField } from '../common/ToggleField';
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
    <form onSubmit={(e) => void submit(e)} className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{exam ? 'Exam settings' : 'New exam'}</CardTitle>
          <CardDescription>The basics students see when they join.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField label="Title" className="md:col-span-2">
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <FormField label="Duration (minutes, 1–600)">
            <Input
              type="number"
              min={1}
              max={600}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
            />
          </FormField>
          <FormField label="Class list">
            <OptionSelect
              value={classListId}
              onChange={setClassListId}
              options={[
                { value: '', label: 'None yet (needed before the exam is ready)' },
                ...classLists.map((l) => ({ value: l.id, label: `${l.name} (${l.studentCount})` })),
              ]}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Students&apos; tools</CardTitle>
          <CardDescription>
            Files stay on the student&apos;s PC and are not submitted. The exam terminal is switched
            on and off while the exam runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleField
            checked={filesEnabled}
            onCheckedChange={setFilesEnabled}
            label="Files panel"
            description="Students can create, read and write files in their project folder."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monitoring</CardTitle>
          <CardDescription>
            When screenshots are taken and which apps count as serious.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonitoringFields
            monitoring={monitoring}
            apps={apps}
            onMonitoring={setMonitoring}
            onApps={setApps}
          />
        </CardContent>
      </Card>

      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid}>
          {busy && <Spinner />}
          {exam ? 'Save' : 'Create exam'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
