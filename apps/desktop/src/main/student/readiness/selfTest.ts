import { mkdir, rm, statfs, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type {
  QuestionLanguage,
  ReadinessCheck,
  ReadinessCheckName,
  ReadinessReport,
} from '@examguard/shared';
import { LANGUAGES, type ToolPaths } from '../../runner/languages.js';
import { spawnLimited } from '../../runner/spawnLimited.js';

/** Free space the exam workspace needs (programs, packages, the files the teacher sends). */
export const MIN_FREE_BYTES = 500 * 1024 * 1024;
const COMPILE_MS = 20_000;
const RUN_MS = 10_000;

/** A tiny program per language that prints `ok`. */
const PROGRAMS: Record<QuestionLanguage, string> = {
  c: '#include <stdio.h>\nint main(void) { puts("ok"); return 0; }\n',
  cpp: '#include <iostream>\nint main() { std::cout << "ok\\n"; return 0; }\n',
  py: 'print("ok")\n',
  js: 'console.log("ok");\n',
};

const ORDER: { lang: QuestionLanguage; name: ReadinessCheckName }[] = [
  { lang: 'c', name: 'c' },
  { lang: 'cpp', name: 'cpp' },
  { lang: 'py', name: 'python' },
  { lang: 'js', name: 'js' },
];

export interface ExecResult {
  ok: boolean;
  stdout: string;
  /** Compiler or runtime errors, or why it did not finish. */
  detail: string;
}

export interface SelfTestDeps {
  tools: ToolPaths;
  /** A scratch folder; it is emptied first and removed afterwards. */
  workDir: string;
  env: NodeJS.ProcessEnv;
  exec?: (
    argv: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeMs: number,
  ) => Promise<ExecResult>;
  freeBytes?: (dir: string) => Promise<number>;
  now?: () => number;
}

async function defaultExec(
  [command = '', ...args]: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeMs: number,
): Promise<ExecResult> {
  const result = await spawnLimited({
    command,
    args,
    cwd,
    env,
    stdin: '',
    outputCap: 64 * 1024,
    timeMs,
  }).done;
  const timedOut = result.reason === 'time_limit';
  return {
    ok: result.reason === 'ok' && result.exitCode === 0,
    stdout: result.stdout,
    detail: timedOut ? 'Timed out' : result.error || result.stderr.trim().split('\n')[0] || '',
  };
}

async function defaultFreeBytes(dir: string): Promise<number> {
  const s = await statfs(dir);
  return s.bavail * s.bsize;
}

/** Short enough for the roster tooltip. */
const short = (text: string) => (text.length > 200 ? `${text.slice(0, 197)}…` : text);

/**
 * The lobby readiness check (M54): compile and run a hello program for C, C++, Python and
 * JavaScript with the bundled toolchains, and check free disk space. It runs before the exam, so
 * it is not bound by the exam's run rules (`runRefusal`).
 */
export async function runSelfTest(deps: SelfTestDeps): Promise<ReadinessReport> {
  const exec = deps.exec ?? defaultExec;
  // Monotonic, so a clock change during the check never gives a negative time (M60).
  const now = deps.now ?? (() => performance.now());
  const elapsed = (started: number) => Math.max(0, Math.round(now() - started));
  const env = {
    ...deps.env,
    ...(deps.tools.mingwBin
      ? { PATH: `${deps.tools.mingwBin}${delimiter}${deps.env.PATH ?? deps.env.Path ?? ''}` }
      : {}),
  };
  await rm(deps.workDir, { recursive: true, force: true });
  await mkdir(deps.workDir, { recursive: true });
  const checks: ReadinessCheck[] = [];
  try {
    for (const { lang, name } of ORDER) {
      const started = now();
      const config = LANGUAGES[lang];
      const fail = (message: string) =>
        checks.push({ name, ok: false, ms: elapsed(started), message: short(message) });
      const missing =
        config.unavailable?.(deps.tools) ??
        (config.compile && !deps.tools.mingwBin ? 'The C/C++ compiler is missing.' : null);
      if (missing) {
        fail(missing);
        continue;
      }
      const dir = join(deps.workDir, lang);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, config.fileName), PROGRAMS[lang], 'utf8');
      for (const [file, text] of Object.entries(config.files ?? {})) {
        await writeFile(join(dir, file), text, 'utf8');
      }
      const runEnv = { ...env, ...config.env };
      if (config.compile) {
        const compiled = await exec(config.compile(deps.tools, []), dir, runEnv, COMPILE_MS);
        if (!compiled.ok) {
          fail(compiled.detail || 'Could not compile.');
          continue;
        }
      }
      const ran = await exec(config.run(deps.tools, dir, []), dir, runEnv, RUN_MS);
      if (!ran.ok || ran.stdout.trim() !== 'ok') {
        fail(ran.detail || 'The program did not run.');
        continue;
      }
      checks.push({ name, ok: true, ms: elapsed(started) });
    }
    const started = now();
    const free = await (deps.freeBytes ?? defaultFreeBytes)(deps.workDir);
    const enough = free >= MIN_FREE_BYTES;
    checks.push({
      name: 'disk',
      ok: enough,
      ms: elapsed(started),
      ...(enough ? {} : { message: `Only ${Math.floor(free / 1024 / 1024)} MB free` }),
    });
  } finally {
    await rm(deps.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return { checks };
}
