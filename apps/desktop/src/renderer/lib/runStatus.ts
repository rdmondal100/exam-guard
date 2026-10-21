import type { RunResult } from '@examguard/shared';

export type RunTab = 'output' | 'errors';

/** What the Errors tab shows: compiler output, then the program's stderr. */
export function errorsText(r: RunResult): string {
  return [r.compileOutput, r.stderr].filter((t) => t.trim()).join('\n\n');
}

/** The tab to open after a run: Errors when that is where the news is. */
export function tabAfterRun(r: RunResult): RunTab {
  if (r.status === 'compile_error') return 'errors';
  return !r.stdout.trim() && errorsText(r) ? 'errors' : 'output';
}

/** "Exit code 0 · 12 ms" plus the reason the run ended, if it is not a plain finish. */
export function statusLine(r: RunResult): { text: string; tone: 'ok' | 'warn' | 'error' } {
  const parts: string[] = [];
  if (r.exitCode !== null) parts.push(`Exit code ${r.exitCode}`);
  if (r.timeMs !== null) parts.push(`${r.timeMs} ms`);
  if (r.message) parts.push(r.message);
  const text = parts.join(' · ') || 'Finished';
  if (r.status === 'ok') return { text, tone: r.exitCode === 0 && !r.message ? 'ok' : 'warn' };
  if (r.status === 'stopped') return { text, tone: 'warn' };
  return { text, tone: 'error' };
}
