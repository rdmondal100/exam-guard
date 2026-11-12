import { useCallback, useEffect, useMemo, useState } from 'react';
import { InfoIcon, PlayIcon, SquareIcon } from 'lucide-react';
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

  const joined = counts
    ? `${counts.joined} joined · ${counts.inLobby} in lobby · ${counts.connected} connected`
    : '0 joined';

  return (
    <Card aria-label="Hosting" className={running ? 'border-success/40' : 'border-primary/40'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <span
            aria-hidden
            className={`size-2.5 animate-pulse rounded-full ${running ? 'bg-success' : 'bg-primary'}`}
          />
          {running ? 'Exam running' : 'Hosting: waiting for students'}
        </CardTitle>
        <CardDescription>
          {joined}
          {!roster.live && <span className="ml-2 text-warning">(reconnecting…)</span>}
        </CardDescription>
        <CardAction className="flex gap-2">
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
            items={[
              {
                label: 'PIN',
                value: (
                  <span className="font-mono text-3xl font-bold tracking-widest">{info.pin}</span>
                ),
              },
              {
                label: 'Address',
                value: (
                  <span className="font-mono">
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
