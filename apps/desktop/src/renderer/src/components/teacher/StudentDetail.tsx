import { useCallback, useState } from 'react';
import { ActivityIcon, MonitorPlayIcon, SquareTerminalIcon } from 'lucide-react';
import type { EventRow, ExamState, RosterEntry } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ExamApi } from '@/api/examApi';
import { formatDuration } from '@/lib/eventsView';
import { riskLevel, statusText } from '@/lib/rosterTable';
import { clockTime } from '@/lib/terminalLog';
import { useEvents } from '@/hooks/useEvents';
import type { RosterView } from '@/hooks/useRoster';
import { ErrorAlert } from '../common/ErrorAlert';
import { KeyValueList } from '../common/KeyValueList';
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
 * live alerts, and while the exam runs a live screen (WebRTC video, the fast thumbnail as
 * fallback; M34). A non-modal side sheet: the board behind it stays usable, so a click on another
 * row switches the student.
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

  return (
    <Sheet open modal={false} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        aria-label={`Student ${s.studentCode}`}
        className="w-full gap-0 sm:max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="truncate text-xl">{s.name}</SheetTitle>
          <SheetDescription className="font-mono">{s.studentCode}</SheetDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            {canWatch && !liveScreen && (
              <Button size="sm" variant="outline" onClick={() => setLiveScreen(true)}>
                <MonitorPlayIcon />
                Live screen
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onTerminalLog(s)}>
              <SquareTerminalIcon />
              Terminal log
            </Button>
          </div>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <KeyValueList
            className="grid-cols-[auto_1fr_auto_1fr]"
            items={[
              { label: 'Status', value: statusText(s) },
              { label: 'Risk score', value: `${s.riskScore} (${riskLevel(s.riskScore)})` },
              {
                label: 'Time outside',
                value: s.outsideMs > 0 ? formatDuration(s.outsideMs) : 'none',
              },
              { label: 'Screens', value: String(s.monitors) },
              {
                label: 'Monitoring',
                value: (
                  <span className={s.monitorOk ? 'text-success' : 'text-destructive'}>
                    {s.monitorOk ? 'working' : 'not working'}
                  </span>
                ),
              },
              { label: 'Last seen', value: s.lastSeen ? clockTime(s.lastSeen) : '—' },
            ]}
          />
          {liveScreen && examState === 'running' && (
            <LiveView student={s} roster={roster} onClose={closeLiveScreen} />
          )}
          <StudentActionsPanel examId={examId} examState={examState} api={api} student={s} />
          <Separator />
          <h3 className="flex items-center gap-2 font-semibold">
            <ActivityIcon className="size-4 text-muted-foreground" aria-hidden />
            Timeline
          </h3>
          {error && <ErrorAlert>{error}</ErrorAlert>}
          {events.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">No events for this student yet.</p>
          )}
          <ol aria-label="Timeline" className="divide-y">
            {events.map((e) => (
              <EventLine key={e.id} event={e} api={api} onOpenShot={setShown} inlineShot />
            ))}
          </ol>
        </div>
        {shown && <ScreenshotDialog event={shown} api={api} onClose={() => setShown(null)} />}
      </SheetContent>
    </Sheet>
  );
}
