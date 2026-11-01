import { useMemo, useState } from 'react';
import type { EventRow, Severity } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';
import { describeEvent, programCounts } from '@/lib/eventsView';
import { clockTime } from '@/lib/terminalLog';
import { useEvents } from '@/hooks/useEvents';
import { ScreenshotDialog } from './ScreenshotDialog';

interface Props {
  examId: string;
  api: ExamApi;
}

const SEVERITY_STYLE: Record<Severity, string> = {
  low: 'text-muted',
  medium: 'text-amber-700',
  high: 'text-red-700',
  critical: 'font-semibold text-red-800',
};

/** What the monitoring agents saw: leaving the exam, tab changes and coming back, with pictures. */
export function EventsPanel({ examId, api }: Props) {
  const { events, error } = useEvents(examId, api);
  const [student, setStudent] = useState('');
  const [shown, setShown] = useState<EventRow | null>(null);
  const [listed, setListed] = useState<number | null>(null);

  const students = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (e.examStudentId)
        seen.set(e.examStudentId, `${e.studentCode ?? ''} ${e.studentName ?? ''}`);
    }
    return [...seen.entries()];
  }, [events]);
  const visible = student ? events.filter((e) => e.examStudentId === student) : events;

  return (
    <section
      aria-label="Monitoring events"
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">Monitoring events</h2>
        <label className="ml-auto flex items-center gap-2 text-sm">
          Student
          <select
            className="h-8 rounded-md border border-border bg-background px-2"
            value={student}
            onChange={(e) => setStudent(e.target.value)}
          >
            <option value="">Everyone</option>
            {students.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
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
      {visible.length === 0 && !error && (
        <p className="text-sm text-muted">
          Nothing seen yet. Switching away from the exam shows up here.
        </p>
      )}
      {visible.length > 0 && (
        <ol aria-label="Events" className="max-h-80 divide-y divide-border overflow-auto">
          {visible.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
              <span className="w-16 shrink-0 font-mono text-muted">{clockTime(e.serverTs)}</span>
              <span className="w-40 shrink-0 truncate">
                <span className="font-mono">{e.studentCode}</span> {e.studentName}
              </span>
              <span className={`flex-1 truncate ${SEVERITY_STYLE[e.severity]}`}>
                {describeEvent(e)}
              </span>
              {e.type === 'processes_at_start' && programCounts(e.details).length > 0 && (
                <button
                  type="button"
                  aria-expanded={listed === e.id}
                  className="rounded-md border px-2 py-0.5 text-xs"
                  onClick={() => setListed(listed === e.id ? null : e.id)}
                >
                  Programs
                </button>
              )}
              {e.hasScreenshot && (
                <button
                  type="button"
                  className="rounded-md border px-2 py-0.5 text-xs"
                  onClick={() => setShown(e)}
                >
                  Screenshot
                </button>
              )}
              {listed === e.id && (
                <ul
                  aria-label="Programs running at the start"
                  className="w-full columns-2 pl-20 text-xs"
                >
                  {programCounts(e.details).map(({ exe, count }) => (
                    <li key={exe} className="font-mono">
                      {exe}
                      {count > 1 ? ` ×${count}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {shown && <ScreenshotDialog event={shown} api={api} onClose={() => setShown(null)} />}
    </section>
  );
}
