import { useEffect, useState } from 'react';
import type { InternetState, RosterEntry } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/lib/examApi';
import { internetCoverage, internetLabel } from '@/lib/internetSwitch';

interface Props {
  examId: string;
  api: ExamApi;
  /** From `GET /exams/:id/hosting`. */
  initial: InternetState;
  /** The live roster: each student's PC reports whether its block is in place. */
  students: RosterEntry[];
}

/** The internet switch: turn student internet off or on. The teacher PC always stays reachable. */
export function InternetControl({ examId, api, initial, students }: Props) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setState(initial), [initial]);

  const set = async (allowed: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setState((await api.setInternet(examId, allowed)).internet);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const coverage = internetCoverage(students, state);
  const settling = coverage.applied < coverage.total;

  return (
    <div aria-label="Student internet" className="flex flex-wrap items-center gap-3">
      <span className="font-medium">Student internet</span>
      <span
        role="status"
        className={`rounded-md px-2 py-0.5 text-sm ${
          state === 'allowed'
            ? 'bg-black/5'
            : settling
              ? 'bg-amber-100 text-amber-900'
              : 'bg-green-100 text-green-900'
        }`}
      >
        {internetLabel(state, coverage)}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          className="h-8 px-3"
          variant="outline"
          disabled={busy || state === 'blocked'}
          onClick={() => void set(false)}
        >
          Turn off
        </Button>
        <Button
          className="h-8 px-3"
          variant="outline"
          disabled={busy || state === 'allowed'}
          onClick={() => void set(true)}
        >
          Turn on
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
