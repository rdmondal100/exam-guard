import { useState } from 'react';
import { BellIcon } from 'lucide-react';
import type { EventRow, RosterEntry, Severity } from '@examguard/shared';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { ExamApi } from '@/api/examApi';
import { MIN_SEVERITY_CHOICES } from '@/lib/eventFeed';
import { useEvents } from '@/hooks/useEvents';
import type { RosterView } from '@/hooks/useRoster';
import { EmptyState } from '../common/EmptyState';
import { ErrorAlert } from '../common/ErrorAlert';
import { OptionSelect } from '../common/OptionSelect';
import { EventLine } from './EventLine';
import { ScreenshotDialog } from './ScreenshotDialog';

interface Props {
  examId: string;
  api: ExamApi;
  /** Live alerts and the student list for the filter. */
  roster: RosterView;
  students: RosterEntry[];
  /** Opens a student's detail. */
  onStudent: (examStudentId: string) => void;
}

/**
 * The live alert feed across all students (M31): every monitoring event as it is stored, newest
 * first, filtered by severity and student. Pushed over the teacher socket; fetched again after a
 * reconnect to fill the gap.
 */
export function EventsPanel({ examId, api, roster, students, onStudent }: Props) {
  const [student, setStudent] = useState('');
  const [minSeverity, setMinSeverity] = useState<Severity>('low');
  const [shown, setShown] = useState<EventRow | null>(null);
  const { events, error } = useEvents(examId, api, {
    ...(student ? { studentId: student } : {}),
    minSeverity,
    live: roster.alerts,
    connects: roster.connects,
  });

  return (
    <Card aria-label="Alert feed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <BellIcon className="size-4 text-muted-foreground" aria-hidden />
          Alerts
        </CardTitle>
        <CardDescription>
          Newest first
          {!roster.live && <span className="ml-2 text-warning">(reconnecting…)</span>}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            Severity
            <OptionSelect
              size="sm"
              className="w-32 text-foreground"
              value={minSeverity}
              onChange={(v) => setMinSeverity(v as Severity)}
              options={MIN_SEVERITY_CHOICES}
            />
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            Student
            <OptionSelect
              size="sm"
              className="w-48 text-foreground"
              value={student}
              onChange={setStudent}
              options={[
                { value: '', label: 'Everyone' },
                ...students.map((s) => ({ value: s.id, label: `${s.studentCode} ${s.name}` })),
              ]}
            />
          </label>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {events.length === 0 && !error && (
          <EmptyState
            icon={BellIcon}
            title="Nothing to show yet."
            description="Switching away from the exam, pastes from outside and other alerts appear here as they happen."
          />
        )}
        {events.length > 0 && (
          <ol
            aria-label="Events"
            className="max-h-96 divide-y overflow-auto rounded-lg border px-2"
          >
            {events.map((e) => (
              <EventLine
                key={e.id}
                event={e}
                api={api}
                onOpenShot={setShown}
                onStudent={onStudent}
              />
            ))}
          </ol>
        )}
        {shown && <ScreenshotDialog event={shown} api={api} onClose={() => setShown(null)} />}
      </CardContent>
    </Card>
  );
}
