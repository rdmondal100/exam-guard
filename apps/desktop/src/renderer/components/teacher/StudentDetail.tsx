import { useCallback, useState } from 'react';
import type { EventRow, ExamState, RosterEntry } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/api/examApi';
import { formatDuration } from '@/lib/eventsView';
import { riskLevel, statusText } from '@/lib/rosterTable';
import { clockTime } from '@/lib/terminalLog';
import { useEvents } from '@/hooks/useEvents';
import type { RosterView } from '@/hooks/useRoster';
import { EventLine } from './EventLine';
import { LiveView } from './LiveView';
import { ScreenshotDialog } from './ScreenshotDialog';
import { StudentActionsPanel } from './StudentActionsPanel';

interface Props {
  examId: string;
  api: ExamApi;
  student: RosterEntry;
  roster: RosterView;
  /** Which actions fit (M35). */
  examState: ExamState;
  onTerminalLog: (student: RosterEntry) => void;
  onClose: () => void;
}

/**
 * One student's status and event timeline with the screenshots inline (M32), kept current by the
 * live alerts, and while the exam runs a live screen (WebRTC video, the fast thumbnail as fallback; M34). A side panel over the
 * dashboard.
 */
export function StudentDetail({
  examId,
  api,
  student: s,
  roster,
  examState,
  onTerminalLog,
  onClose,
}: Props) {
  const [shown, setShown] = useState<EventRow | null>(null);
  const [liveScreen, setLiveScreen] = useState(false);
  const closeLiveScreen = useCallback(() => setLiveScreen(false), []);
  const canWatch = examState === 'running' && s.connected;
  const { events, error } = useEvents(examId, api, {
    studentId: s.id,
    live: roster.alerts,
    connects: roster.connects,
  });
  const facts: [string, string][] = [
    ['Status', statusText(s)],
    ['Risk score', `${s.riskScore} (${riskLevel(s.riskScore)})`],
    ['Time outside', s.outsideMs > 0 ? formatDuration(s.outsideMs) : 'none'],
    ['Screens', String(s.monitors)],
    ['Monitoring agent', s.agentOk ? 'running' : 'not running'],
    ['Last seen', s.lastSeen ? clockTime(s.lastSeen) : '—'],
  ];

  return (
    <aside
      role="dialog"
      aria-label={`Student ${s.studentCode}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col gap-3 border-l border-border bg-card p-4 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">{s.name}</h2>
          <p className="font-mono text-muted">{s.studentCode}</p>
        </div>
        <div className="ml-auto flex gap-2">
          {canWatch && !liveScreen && (
            <Button variant="outline" className="h-8 px-3" onClick={() => setLiveScreen(true)}>
              Live screen
            </Button>
          )}
          <Button variant="outline" className="h-8 px-3" onClick={() => onTerminalLog(s)}>
            Terminal log
          </Button>
          <Button className="h-8 px-3" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-1 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {liveScreen && examState === 'running' && (
        <LiveView student={s} roster={roster} onClose={closeLiveScreen} />
      )}
      <StudentActionsPanel examId={examId} examState={examState} api={api} student={s} />
      <h3 className="font-semibold">Timeline</h3>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {events.length === 0 && !error && (
        <p className="text-sm text-muted">No events for this student yet.</p>
      )}
      <ol aria-label="Timeline" className="min-h-0 flex-1 divide-y divide-border overflow-auto">
        {events.map((e) => (
          <EventLine key={e.id} event={e} api={api} onOpenShot={setShown} inlineShot />
        ))}
      </ol>
      {shown && <ScreenshotDialog event={shown} api={api} onClose={() => setShown(null)} />}
    </aside>
  );
}
