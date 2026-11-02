import { useState } from 'react';
import type { EventRow } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';
import { useEvents } from '@/hooks/useEvents';
import { EventLine } from './EventLine';
import { ScreenshotDialog } from './ScreenshotDialog';

interface Props {
  examId: string;
  api: ExamApi;
  examStudentId: string;
}

/** The student's event timeline with the screenshots inline, beside their answer (M39). */
export function AnswerTimeline({ examId, api, examStudentId }: Props) {
  const [shown, setShown] = useState<EventRow | null>(null);
  const { events, error } = useEvents(examId, api, { studentId: examStudentId });
  return (
    <section aria-label="Event timeline" className="flex flex-col gap-2">
      <h3 className="font-semibold">Event timeline</h3>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {events.length === 0 ? (
        <p className="text-sm text-muted">No events for this student.</p>
      ) : (
        <ol aria-label="Timeline" className="max-h-[28rem] divide-y divide-border overflow-auto">
          {events.map((e) => (
            <EventLine key={e.id} event={e} api={api} onOpenShot={setShown} inlineShot />
          ))}
        </ol>
      )}
      {shown && <ScreenshotDialog event={shown} api={api} onClose={() => setShown(null)} />}
    </section>
  );
}
