import { useEffect, useState } from 'react';
import type { QuestionLanguage, RunResult } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { runKey, useRunStore } from '@/lib/runStore';
import { errorsText, statusLine, tabAfterRun, type RunTab } from '@/lib/runStatus';

interface Props {
  questionId: string;
  language: QuestionLanguage;
  code: string;
}

const TONE = {
  ok: 'text-green-800',
  warn: 'text-amber-800',
  error: 'text-red-700',
} as const;

const failure = (message: string): RunResult => ({
  status: 'failed',
  exitCode: null,
  timeMs: null,
  stdout: '',
  stderr: '',
  compileOutput: '',
  diagnostics: [],
  message,
});

/** Seconds left until `until`, ticking while above zero. */
function useCountdown(until: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Under the editor: stdin, Run/Stop, Output/Errors tabs, exit code and run time. The code runs
 * on this PC only (student main), for the student's own checking.
 */
export function RunPanel({ questionId, language, code }: Props) {
  const key = runKey(questionId, language);
  const stdin = useRunStore((s) => s.stdin[key] ?? '');
  const result = useRunStore((s) => s.results[key]);
  const running = useRunStore((s) => s.running);
  const cooldownUntil = useRunStore((s) => s.cooldownUntil);
  const { setStdin, start, finish } = useRunStore.getState();
  const [tab, setTab] = useState<RunTab>('output');
  const wait = useCountdown(cooldownUntil);
  const busyHere = running === key;

  const run = async () => {
    start(key);
    let r: RunResult;
    try {
      r = await window.examguard.runCode({ questionId, language, code, stdin });
    } catch (e) {
      r = failure(e instanceof Error ? e.message : 'The run failed.');
    }
    finish(key, r, Date.now());
    setTab(tabAfterRun(r));
  };

  const errors = result ? errorsText(result) : '';
  const shown = tab === 'output' ? (result?.stdout ?? '') : errors;
  const status = result && statusLine(result);

  return (
    <div className="flex h-60 shrink-0 gap-3">
      <label className="flex w-64 shrink-0 flex-col gap-1 text-sm font-medium">
        Input (stdin)
        <textarea
          value={stdin}
          onChange={(e) => setStdin(key, e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-md border p-2 font-mono text-sm font-normal"
        />
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button onClick={() => void run()} disabled={running !== null || wait > 0}>
            {busyHere ? 'Running…' : wait > 0 ? `Run (${wait} s)` : 'Run'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void window.examguard.stopRun()}
            disabled={!busyHere}
          >
            Stop
          </Button>
          <div role="tablist" className="ml-4 flex gap-1 text-sm">
            {(['output', 'errors'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 ${tab === t ? 'bg-black/10 font-medium' : ''}`}
              >
                {t === 'output' ? 'Output' : 'Errors'}
                {t === 'errors' && errors && ' •'}
              </button>
            ))}
          </div>
          {status && (
            <span role="status" className={`ml-auto truncate text-sm ${TONE[status.tone]}`}>
              {status.text}
            </span>
          )}
        </div>
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border bg-black/5 p-2 font-mono text-sm whitespace-pre-wrap">
          {busyHere
            ? 'Running…'
            : shown || (result ? '(nothing)' : 'Press Run to compile and run your code.')}
        </pre>
      </div>
    </div>
  );
}
