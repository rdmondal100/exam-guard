import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAgentStatus } from '@/lib/useAgentStatus';
import { AgentChip } from './AgentChip';

const POLL_MS = 2000;

/**
 * Student mode: nothing else is shown until the monitoring agent is running. If it is not
 * installed, the app asks Windows for administrator approval (one UAC prompt) and sets it up by
 * itself; the button is there for when that prompt was declined. Once the agent has been seen
 * running, the gate stays open, so an agent that stops later cannot knock a student out of an exam.
 */
export function AgentGate({ children }: { children: ReactNode }) {
  const { status, refresh } = useAgentStatus(POLL_MS);
  const [passed, setPassed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triedAutomatically = useRef(false);

  const state = status?.state;
  useEffect(() => {
    if (state === 'running') setPassed(true);
  }, [state]);

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

  const canInstall = status?.exeFound === true && (state === 'missing' || state === 'stopped');
  useEffect(() => {
    if (!canInstall || triedAutomatically.current) return;
    triedAutomatically.current = true;
    void install();
  }, [canInstall, install]);

  if (passed)
    return (
      <>
        {children}
        <AgentChip />
      </>
    );
  if (!status) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="text-muted">Checking the monitoring agent…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-8">
      <h1 className="text-3xl font-semibold">Monitoring agent not running</h1>
      <p className="text-sm leading-relaxed">
        ExamGuard needs its monitoring agent on this computer before you can join an exam.{' '}
        {busy
          ? 'Waiting for the setup to finish…'
          : state === 'unknown'
            ? 'The agent is starting. This page continues by itself.'
            : 'Windows will ask for administrator approval to set it up.'}
      </p>
      {!status.exeFound && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          The agent program (eg-agent.exe) was not found. Ask your lab technician to reinstall
          ExamGuard.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      <div>
        <Button onClick={install} disabled={busy || !status.exeFound}>
          {busy ? 'Setting up…' : 'Set up monitoring'}
        </Button>
      </div>
    </main>
  );
}
