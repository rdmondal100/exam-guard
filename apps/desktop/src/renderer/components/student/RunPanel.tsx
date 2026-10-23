import { lazy, Suspense, useEffect, useState } from 'react';
import type { QuestionLanguage, RunResult } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { useAnswerStore } from '@/lib/answerStore';
import { runKey, useRunStore } from '@/lib/runStore';
import { saveNow } from '@/lib/useAutosave';
import { errorsText, statusLine, tabAfterRun, type RunTab } from '@/lib/runStatus';
import { RunFlagsInput } from './RunFlagsInput';

const ProgramConsole = lazy(() => import('./ProgramConsole'));

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
 * Under the editor: flags, Run/Stop, the program's console (the student types into it; a window
 * program opens its own window), the Errors tab, exit code and run time. The code runs on this PC
 * only (student main), for the student's own checking.
 */
export function RunPanel({ questionId, language, code }: Props) {
  const key = runKey(questionId, language);
  const result = useRunStore((s) => s.results[key]);
  const running = useRunStore((s) => s.running);
  const cooldownUntil = useRunStore((s) => s.cooldownUntil);
  const flags = useAnswerStore((s) => s.flags[questionId]?.[language] ?? '');
  const { start, finish } = useRunStore.getState();
  const [tab, setTab] = useState<RunTab>('output');
  const wait = useCountdown(cooldownUntil);
  const busyHere = running === key;

  const run = async () => {
    void saveNow('run');
    start(key);
    let r: RunResult;
    try {
      r = await window.examguard.runCode({
        questionId,
        language,
        code,
        flags,
      });
    } catch (e) {
      r = failure(e instanceof Error ? e.message : 'The run failed.');
    }
    finish(key, r, Date.now());
    setTab(tabAfterRun(r));
  };

  const errors = result ? errorsText(result) : '';
  const showConsole = tab === 'output';
  const status = result && statusLine(result);
  const errorsShown = busyHere ? 'Running…' : errors || (result ? '(nothing)' : 'No errors.');

  return (
    <div className="flex h-72 shrink-0 gap-3">
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
          <div role="tablist" className="flex gap-1 text-sm">
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
        <RunFlagsInput
          language={language}
          value={flags}
          onChange={(v) => useAnswerStore.getState().setFlags(questionId, language, v)}
          disabled={running !== null}
        />
        <Suspense fallback={<p className="p-3 text-sm text-muted">Loading console…</p>}>
          <ProgramConsole runKey={key} active={busyHere} hidden={!showConsole} />
        </Suspense>
        {!showConsole && (
          <pre className="min-h-0 flex-1 overflow-auto rounded-md border bg-black/5 p-2 font-mono text-sm whitespace-pre-wrap">
            {errorsShown}
          </pre>
        )}
      </div>
    </div>
  );
}
