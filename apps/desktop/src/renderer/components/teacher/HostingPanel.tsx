import { useEffect, useState } from 'react';
import type { HostingInfo } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/lib/examApi';
import { sortedStudents } from '@/lib/rosterState';
import { useRoster } from '@/lib/useRoster';
import { RosterList } from './RosterList';

interface Props {
  examId: string;
  api: ExamApi;
  onStop: () => Promise<void>;
}

/** PIN, addresses and fingerprint code for a hosted exam. Joined students update live. */
export function HostingPanel({ examId, api, onStop }: Props) {
  const [info, setInfo] = useState<HostingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const roster = useRoster(examId);
  const counts = roster.counts;

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
  }, [api, examId]);

  const stop = async () => {
    setStopping(true);
    try {
      await onStop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStopping(false);
    }
  };

  return (
    <section
      aria-label="Hosting"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Hosting: waiting for students</h2>
        <Button variant="outline" disabled={stopping} onClick={() => void stop()}>
          Stop hosting
        </Button>
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
      <RosterList students={sortedStudents(roster)} />
      <p className="text-sm text-muted">
        Students enter the address, the PIN and their ID. With a typed address, they compare the
        check code on their screen with this one.
      </p>
    </section>
  );
}
