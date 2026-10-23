import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAgentStatus } from '@/lib/useAgentStatus';
import { AgentChip } from './AgentChip';

const POLL_MS = 2000;
/** The agent may be unhealthy this long (a reconnect, a helper restart) before the screen blocks. */
const BLOCK_AFTER_MS = 3000;

/**
 * Student mode: before a student joins an exam, nothing else is shown unless the monitoring agent
 * is linked and its system check passes. If the service is not installed, the app asks Windows for
 * administrator approval (one UAC prompt) and sets it up by itself; the button is there for when
 * that prompt was declined or the agent runs but does not answer. `bypass` is true once there is
 * a session (joined, resuming, in the exam): an agent that stops later must not knock a student
 * out of an exam, and the server hears about it through `agent.status` instead.
 */
export function AgentGate({ children, bypass }: { children: ReactNode; bypass: boolean }) {
  const { status, refresh } = useAgentStatus(POLL_MS);
  const [blocked, setBlocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triedAutomatically = useRef(false);

  const healthy = status?.link.ok === true;
  useEffect(() => {
    if (healthy) {
      setBlocked(false);
      return;
    }
    const timer = setTimeout(() => setBlocked(true), BLOCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [healthy]);

  const install = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.examguard.installAgent();
      if (!result.ok) setError(result.error ?? 'Monitoring could not be set up.');
    } catch {
      setError('Monitoring could not be set up.');
    } finally {
      setBusy(false);
      refresh();
    }
  }, [refresh]);

  const state = status?.state;
  const canInstall =
    !bypass && status?.exeFound === true && (state === 'missing' || state === 'stopped');
  useEffect(() => {
    if (!canInstall || triedAutomatically.current) return;
    triedAutomatically.current = true;
    void install();
  }, [canInstall, install]);

  const showBlock = !bypass && (status === null || (blocked && !healthy));
  const problem = status?.link.problems[0];

  return (
    <>
      <div hidden={showBlock}>{children}</div>
      {showBlock && (
        <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-8">
          {status === null ? (
            <p className="text-muted">Checking the monitoring agent…</p>
          ) : (
            <>
              <h1 className="text-3xl font-semibold">Monitoring agent not running</h1>
              <p className="text-sm leading-relaxed">
                ExamGuard needs its monitoring agent on this computer before you can join an exam.{' '}
                {busy
                  ? 'Waiting for the setup to finish…'
                  : state === 'running'
                    ? 'The agent is running but is not answering as it should.'
                    : state === 'unknown'
                      ? 'The agent is starting. This page continues by itself.'
                      : 'Windows will ask for administrator approval to set it up.'}
              </p>
              {problem && state !== 'missing' && state !== 'stopped' && (
                <p className="text-sm text-muted">{problem}</p>
              )}
              {!status.exeFound && (
                <p
                  role="alert"
                  className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800"
                >
                  The agent program (eg-agent.exe) was not found. Ask your lab technician to
                  reinstall ExamGuard.
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800"
                >
                  {error}
                </p>
              )}
              <div>
                <Button onClick={install} disabled={busy || !status.exeFound}>
                  {busy ? 'Setting up…' : 'Set up monitoring'}
                </Button>
              </div>
            </>
          )}
        </main>
      )}
      {!showBlock && <AgentChip />}
    </>
  );
}
