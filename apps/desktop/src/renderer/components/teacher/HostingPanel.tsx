import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HostingInfo, RosterEntry } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/lib/examApi';
import { sortedStudents } from '@/lib/rosterState';
import { useRoster } from '@/lib/useRoster';
import { InternetControl } from './InternetControl';
import { RosterList } from './RosterList';
import { TerminalControl } from './TerminalControl';
import { TerminalLogDialog } from './TerminalLogDialog';

interface Props {
  examId: string;
  api: ExamApi;
  /** `running` swaps the Start and Stop buttons for End exam. */
  running: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  /** running → ended. */
  onEnd: () => Promise<void>;
}

/** PIN, addresses and fingerprint code for a hosted exam. Joined students update live. */
export function HostingPanel({ examId, api, running, onStart, onStop, onEnd }: Props) {
  const [info, setInfo] = useState<HostingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [logOf, setLogOf] = useState<RosterEntry | null>(null);
  const roster = useRoster(examId);
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
  }, [api, examId, reloads]);
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

  const start = () => {
    const inLobby = counts?.inLobby ?? 0;
    const ok = window.confirm(
      `Start the exam now? ${inLobby} student${inLobby === 1 ? ' is' : 's are'} in the lobby. ` +
        'Everyone gets the same end time, including students who join later.',
    );
    if (ok) void act(onStart);
  };

  const end = () => {
    const working = counts?.joined ?? 0;
    const ok = window.confirm(
      `End the exam now for all ${working} student${working === 1 ? '' : 's'}? ` +
        'Their exam screens close and this cannot be undone.',
    );
    if (ok) void act(onEnd);
  };

  return (
    <section
      aria-label="Hosting"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          {running ? 'Exam running' : 'Hosting: waiting for students'}
        </h2>
        {running && (
          <Button variant="outline" disabled={stopping} onClick={end}>
            End exam now
          </Button>
        )}
        {!running && (
          <div className="flex gap-2">
            <Button disabled={stopping} onClick={start}>
              Start exam
            </Button>
            <Button variant="outline" disabled={stopping} onClick={() => void act(onStop)}>
              Stop hosting
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {info ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-muted">PIN</dt>
          <dd className="font-mono text-4xl font-semibold tracking-widest">{info.pin}</dd>
          <dt className="text-muted">Address</dt>
          <dd className="font-mono">
            {info.addresses.length > 0
              ? info.addresses.map((a) => `${a}:${info.port}`).join('   ')
              : 'No network address found'}
          </dd>
          <dt className="text-muted">Check code</dt>
          <dd className="font-mono text-2xl">{info.fpCode}</dd>
          <dt className="text-muted">Joined</dt>
          <dd>
            {counts
              ? `${counts.joined} joined · ${counts.inLobby} in lobby · ${counts.connected} connected`
              : '0 joined'}
            {!roster.live && <span className="ml-2 text-amber-700">(reconnecting…)</span>}
          </dd>
        </dl>
      ) : (
        !error && <p className="text-sm text-muted">Loading hosting details…</p>
      )}
      {terminal && (
        <TerminalControl examId={examId} api={api} initial={terminal} onExpired={reloadInfo} />
      )}
      {info && (
        <InternetControl
          examId={examId}
          api={api}
          initial={info.internet}
          students={sortedStudents(roster)}
        />
      )}
      <RosterList students={sortedStudents(roster)} onTerminalLog={setLogOf} />
      {logOf && (
        <TerminalLogDialog
          examId={examId}
          student={logOf}
          api={api}
          onClose={() => setLogOf(null)}
        />
      )}
      <p className="text-sm text-muted">
        Students enter the address, the PIN and their ID. With a typed address, they compare the
        check code on their screen with this one.
      </p>
    </section>
  );
}
