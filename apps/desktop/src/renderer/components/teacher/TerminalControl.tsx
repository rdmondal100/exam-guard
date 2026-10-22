import { useEffect, useState } from 'react';
import type { TerminalState } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ExamApi } from '@/lib/examApi';
import { parseMinutes, terminalLabel } from '@/lib/terminalSwitch';

interface Props {
  examId: string;
  api: ExamApi;
  /** From `GET /exams/:id/hosting`. */
  initial: { terminal: TerminalState; pendingMinutes: number | null };
  /** Re-reads the hosting info (after an "N minutes" window runs out). */
  onExpired: () => void;
}

/** The exam terminal switch: on, off, or on for N minutes, with a countdown. */
export function TerminalControl({ examId, api, initial, onExpired }: Props) {
  const [state, setState] = useState(initial);
  const [minutes, setMinutes] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setState(initial), [initial]);

  const until = state.terminal.enabled ? state.terminal.until : null;
  useEffect(() => {
    if (until === null) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
      // The teacher UI runs on the server's PC, so its clock is the server clock.
      if (Date.now() >= until) {
        clearInterval(timer);
        onExpired();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [until, onExpired]);

  const set = async (enabled: boolean, forMinutes?: number) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.setTerminal(examId, enabled, forMinutes);
      setState({ terminal: result.terminal, pendingMinutes: result.pendingMinutes });
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const parsed = parseMinutes(minutes);

  return (
    <div aria-label="Exam terminal" className="flex flex-wrap items-center gap-3">
      <span className="font-medium">Exam terminal</span>
      <span
        role="status"
        className={`rounded-md px-2 py-0.5 text-sm ${
          state.terminal.enabled ? 'bg-green-100 text-green-900' : 'bg-black/5'
        }`}
      >
        {terminalLabel(state.terminal, state.pendingMinutes, now)}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button className="h-8 px-3" disabled={busy} onClick={() => void set(true)}>
          Turn on
        </Button>
        <Input
          aria-label="Minutes"
          className="h-8 w-16"
          inputMode="numeric"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <Button
          className="h-8 px-3"
          variant="outline"
          disabled={busy || parsed === null}
          onClick={() => void set(true, parsed ?? undefined)}
        >
          On for {parsed ?? '…'} min
        </Button>
        <Button
          className="h-8 px-3"
          variant="outline"
          disabled={busy || !state.terminal.enabled}
          onClick={() => void set(false)}
        >
          Turn off
        </Button>
      </div>
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
