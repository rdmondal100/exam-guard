import { useState } from 'react';
import type { EventRow } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';
import { describeEvent, programCounts } from '@/lib/eventsView';
import { clockTime } from '@/lib/terminalLog';
import { ScreenshotThumb } from './ScreenshotThumb';
import { SEVERITY_BADGE, SEVERITY_TEXT } from './severityStyle';

interface Props {
  event: EventRow;
  api: ExamApi;
  onOpenShot: (event: EventRow) => void;
  /** Feed: the student's name, a click opens their detail. Timeline: left out. */
  onStudent?: (examStudentId: string) => void;
  /** Timeline: the screenshot inline instead of a button (M32). */
  inlineShot?: boolean;
}

/** One event: time, severity, what happened, and its picture or program list. */
export function EventLine({ event: e, api, onOpenShot, onStudent, inlineShot = false }: Props) {
  const [listed, setListed] = useState(false);
  const programs = e.type === 'processes_at_start' ? programCounts(e.details) : [];
  return (
    <li className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
      <span className="w-16 shrink-0 font-mono text-muted">{clockTime(e.serverTs)}</span>
      <span
        className={`w-16 shrink-0 rounded-md px-1.5 text-center text-xs ${SEVERITY_BADGE[e.severity]}`}
      >
        {e.severity}
      </span>
      {onStudent && (
        <button
          type="button"
          className="w-40 shrink-0 truncate text-left hover:underline"
          disabled={!e.examStudentId}
          onClick={() => e.examStudentId && onStudent(e.examStudentId)}
        >
          <span className="font-mono">{e.studentCode}</span> {e.studentName}
        </button>
      )}
      <span
        className={`min-w-0 flex-1 truncate ${SEVERITY_TEXT[e.severity]}`}
        title={describeEvent(e)}
      >
        {describeEvent(e)}
      </span>
      {programs.length > 0 && (
        <button
          type="button"
          aria-expanded={listed}
          className="rounded-md border px-2 py-0.5 text-xs"
          onClick={() => setListed(!listed)}
        >
          Programs
        </button>
      )}
      {e.hasScreenshot &&
        (inlineShot ? (
          <ScreenshotThumb event={e} api={api} onOpen={onOpenShot} />
        ) : (
          <button
            type="button"
            className="rounded-md border px-2 py-0.5 text-xs"
            onClick={() => onOpenShot(e)}
          >
            Screenshot
          </button>
        ))}
      {listed && (
        <ul aria-label="Programs running at the start" className="w-full columns-2 pl-20 text-xs">
          {programs.map(({ exe, count }) => (
            <li key={exe} className="font-mono">
              {exe}
              {count > 1 ? ` ×${count}` : ''}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
