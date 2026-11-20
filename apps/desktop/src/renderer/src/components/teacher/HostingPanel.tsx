import { useCallback, useEffect, useMemo, useState } from 'react';
import { InfoIcon, PauseIcon, PlayIcon, SquareIcon } from 'lucide-react';
import type { HostingInfo } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { ExamApi } from '@/api/examApi';
import type { RosterView } from '@/hooks/useRoster';
import { useConfirm } from '@/hooks/useConfirm';
import { clockTime } from '@/lib/terminalLog';
import { ErrorAlert } from '../common/ErrorAlert';
import { KeyValueList } from '../common/KeyValueList';
import { LoadingLine } from '../common/Spinner';
import { GlobalActionsPanel } from './GlobalActionsPanel';
import { TeacherExamTimer } from './TeacherExamTimer';
import { TerminalControl } from './TerminalControl';

interface Props {
  examId: string;
  api: ExamApi;
  /** The live roster (the page owns the teacher socket). */
  roster: RosterView;
  /** `running` swaps the Start and Stop buttons for End exam. */
  running: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  /** running → ended. */
  onEnd: () => Promise<void>;
}

/**
 * PIN, addresses and fingerprint code for a hosted exam, the counts, the end time, the terminal
 * switch and the actions for everyone (M36). The students themselves are on the
 * monitoring board (M32).
 */
export function HostingPanel({ examId, api, roster, running, onStart, onStop, onEnd }: Props) {
  const [info, setInfo] = useState<HostingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const confirm = useConfirm();
  const counts = roster.counts;

  const [reloads, setReloads] = useState(0);
  const reloadInfo = useCallback(() => setReloads((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    api
      .hosting(examId)
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // Start sets the end time, so the details are fetched again then.
  }, [api, examId, reloads, running]);
  const terminal = useMemo(
    () => info && { terminal: info.terminal, pendingMinutes: info.terminalPendingMinutes },
    [info],
  );

  const act = async (action: () => Promise<void>) => {
    setStopping(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(false);
    }
  };

  const start = async () => {
    const inLobby = counts?.inLobby ?? 0;
    const ok = await confirm({
      title: 'Start the exam now?',
      description:
        `${inLobby} student${inLobby === 1 ? ' is' : 's are'} in the lobby. ` +
        'Everyone gets the same end time, including students who join later.',
      confirmLabel: 'Start exam',
    });
    if (ok) void act(onStart);
  };

  // M58: pause or resume for everyone. The answer carries the (unchanged or moved) end time.
  const setPaused = async (paused: boolean) => {
    if (paused) {
      const ok = await confirm({
        title: 'Pause the exam for everyone?',
        description:
          'Every student sees "Your teacher paused the exam" and cannot type until you resume. ' +
          'The timer stops; the time spent paused is given back.',
        confirmLabel: 'Pause exam',
      });
      if (!ok) return;
    }
    await act(async () => {
      try {
        const result = await api.setPaused(examId, paused);
        setInfo(
          (prev) => prev && { ...prev, pausedAt: result.pausedAt, deadline: result.deadline },
        );
      } catch (e) {
        // The server may have paused (or resumed) anyway: show what it says now (M60).
        await api
          .hosting(examId)
          .then(setInfo)
          .catch(() => undefined);
        throw e;
      }
    });
  };
  const paused = running && info?.pausedAt != null;

  const end = async () => {
    const working = counts?.joined ?? 0;
    const ok = await confirm({
      title: `End the exam now for all ${working} student${working === 1 ? '' : 's'}?`,
      description: 'Their exam screens close and this cannot be undone.',
      confirmLabel: 'End exam',
      destructive: true,
    });
    if (ok) void act(onEnd);
  };

  // The lobby readiness check (M54): how many waiting PCs passed it.
  const waiting = [...roster.students.values()].filter((s) => s.state === 'lobby');
  const ready = waiting.filter((s) => s.readiness === 'ok').length;
  // M57: students who submitted, and how many have left since (app closed or PC off).
  const submitted = [...roster.students.values()].filter((s) => s.state === 'submitted');
  const joined = counts
    ? `${counts.joined} joined · ${counts.inLobby} in lobby · ${counts.connected} connected` +
      (!running && waiting.length > 0 ? ` · ${ready} of ${waiting.length} ready` : '') +
      (submitted.length > 0
        ? ` · ${submitted.length} submitted (${submitted.filter((s) => !s.connected).length} left)`
        : '')
    : '0 joined';

  return (
    <Card
      aria-label="Hosting"
      className={paused ? 'border-warning/50' : running ? 'border-success/40' : 'border-primary/40'}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <span
            aria-hidden
            className={`size-2.5 rounded-full ${paused ? 'bg-warning' : running ? 'animate-pulse bg-success' : 'animate-pulse bg-primary'}`}
          />
          {paused ? 'Exam paused' : running ? 'Exam running' : 'Hosting: waiting for students'}
        </CardTitle>
        <CardDescription>
          {joined}
          {!roster.live && <span className="ml-2 text-warning">(reconnecting…)</span>}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          {running && info?.deadline != null && (
            <TeacherExamTimer
              deadline={info.deadline}
              extensionMin={info.extensionMin}
              pausedAt={info.pausedAt ?? null}
            />
          )}
          {running && (
            <Button
              variant={paused ? 'default' : 'outline'}
              disabled={stopping || !info}
              onClick={() => void setPaused(!paused)}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
              {paused ? 'Resume exam' : 'Pause exam'}
            </Button>
          )}
          {running ? (
            <Button variant="destructive" disabled={stopping} onClick={() => void end()}>
              <SquareIcon />
              End exam now
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={stopping} onClick={() => void act(onStop)}>
                Stop hosting
              </Button>
              <Button disabled={stopping} onClick={() => void start()}>
                <PlayIcon />
                Start exam
              </Button>
            </>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {info ? (
          <KeyValueList
            layout="tiles"
            // Five tiles only on a wide window: a 6-digit PIN wrapped in a 140 px tile.
            className="lg:grid-cols-3 2xl:grid-cols-5"
            items={[
              {
                label: 'PIN',
                value: (
                  <span className="font-mono text-3xl font-bold tracking-widest whitespace-nowrap">
                    {info.pin}
                  </span>
                ),
              },
              {
                label: 'Address',
                value: (
                  <span className="font-mono whitespace-nowrap">
                    {info.addresses.length > 0
                      ? info.addresses.map((a) => `${a}:${info.port}`).join('   ')
                      : 'No network address found'}
                  </span>
                ),
              },
              {
                label: 'Check code',
                value: <span className="font-mono text-2xl tracking-wider">{info.fpCode}</span>,
              },
              { label: 'Joined', value: counts ? counts.joined : 0 },
              {
                label: 'Ends at',
                value:
                  info.deadline === null ? (
                    <span className="text-muted-foreground">Not started</span>
                  ) : (
                    <span>
                      {clockTime(info.deadline)}
                      {paused && (
                        <span className="block text-xs font-normal text-warning">
                          Paused: the end moves later when you resume
                        </span>
                      )}
                      {info.extensionMin > 0 && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          (+{info.extensionMin} min for everyone; personal extra time on top)
                        </span>
                      )}
                    </span>
                  ),
              },
            ]}
          />
        ) : (
          !error && <LoadingLine>Loading hosting details…</LoadingLine>
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          {terminal && (
            <TerminalControl examId={examId} api={api} initial={terminal} onExpired={reloadInfo} />
          )}
          {info && (
            <GlobalActionsPanel
              examId={examId}
              api={api}
              running={running}
              counts={counts}
              onExtended={reloadInfo}
            />
          )}
        </div>
      </CardContent>
      <CardFooter className="border-t text-sm text-muted-foreground">
        <InfoIcon className="size-4 shrink-0" aria-hidden />
        Students enter the address, the PIN and their ID. With a typed address, they compare the
        check code on their screen with this one.
      </CardFooter>
    </Card>
  );
}
