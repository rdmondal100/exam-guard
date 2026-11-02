import { useState } from 'react';
import type { EventRow, RosterEntry, Severity } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';
import { MIN_SEVERITY_CHOICES } from '@/lib/eventFeed';
import { useEvents } from '@/hooks/useEvents';
import type { RosterView } from '@/hooks/useRoster';
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

const SELECT = 'h-8 rounded-md border border-border bg-background px-2';

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
    <section
      aria-label="Alert feed"
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">Alerts</h2>
        {!roster.live && <span className="text-sm text-amber-700">(reconnecting…)</span>}
        <label className="ml-auto flex items-center gap-2 text-sm">
          Severity
          <select
            className={SELECT}
            value={minSeverity}
            onChange={(e) => setMinSeverity(e.target.value as Severity)}
          >
            {MIN_SEVERITY_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Student
          <select className={SELECT} value={student} onChange={(e) => setStudent(e.target.value)}>
            <option value="">Everyone</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.studentCode} {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {events.length === 0 && !error && (
        <p className="text-sm text-muted">
          Nothing to show yet. Switching away from the exam, pastes from outside and other alerts
          appear here as they happen.
        </p>
      )}
      {events.length > 0 && (
        <ol aria-label="Events" className="max-h-96 divide-y divide-border overflow-auto">
          {events.map((e) => (
            <EventLine key={e.id} event={e} api={api} onOpenShot={setShown} onStudent={onStudent} />
          ))}
        </ol>
      )}
      {shown && <ScreenshotDialog event={shown} api={api} onClose={() => setShown(null)} />}
    </section>
  );
}
