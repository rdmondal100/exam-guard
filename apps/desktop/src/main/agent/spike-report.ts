import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentReport } from '@examguard/shared';

const MAX_LINES = 8;
const TAIL_BYTES = 64 * 1024;

/** The spike agent's output folder: `%ProgramData%\ExamGuard\spike`. */
export function spikeDir(env: NodeJS.ProcessEnv): string {
  return join(env.ProgramData ?? 'C:\\ProgramData', 'ExamGuard', 'spike');
}

/**
 * `2026-10-23T14:39:14.694Z  INFO eg_agent::helper: foreground pid=1 ...` → `14:39:14Z foreground
 * pid=1 ...`. Other lines are returned as they are.
 */
export function shortenLogLine(line: string): string {
  const match = /^\d{4}-\d\d-\d\dT(\d\d:\d\d:\d\d)\S*\s+\w+\s+[\w:]+:\s+(.*)$/.exec(line);
  return match ? `${match[1]}Z ${match[2]}` : line;
}

const INTERESTING = /foreground|screenshot|helper started/;

export function lastEvents(logText: string): string[] {
  return logText
    .split(/\r?\n/)
    .filter((line) => INTERESTING.test(line))
    .slice(-MAX_LINES)
    .map(shortenLogLine);
}

export async function readReport(dir: string): Promise<AgentReport> {
  const log = await readFile(join(dir, 'helper.log'), 'utf8').catch(() => '');
  const names = await readdir(dir).catch(() => [] as string[]);
  return {
    lines: lastEvents(log.slice(-TAIL_BYTES)),
    shotsDir: dir,
    shotCount: names.filter((n) => n.startsWith('shot-') && n.endsWith('.jpg')).length,
  };
}
