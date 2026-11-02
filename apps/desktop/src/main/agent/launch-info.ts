import type { PipeLaunch } from '@examguard/shared';

const MAX_ENV = 32;
const MAX_VALUE = 4096;

/** ExamGuard's own and Electron's dev variables pass, never the one that turns Electron into Node. */
function passes(name: string, value: string): boolean {
  return (
    (name.startsWith('EG_') || name.startsWith('ELECTRON_')) &&
    name !== 'ELECTRON_RUN_AS_NODE' &&
    /^[A-Za-z0-9_]{1,64}$/.test(name) &&
    value.length <= MAX_VALUE
  );
}

/**
 * How the agent should start this app again if it disappears while the exam runs (M24): the same
 * arguments, folder and dev variables. The program itself is the one the agent verified.
 */
export function launchInfo(
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): PipeLaunch {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !passes(name, value)) continue;
    if (Object.keys(vars).length >= MAX_ENV) break;
    vars[name] = value;
  }
  return {
    args: argv
      .slice(1)
      .filter((arg) => arg.length <= 2048)
      .slice(0, 32),
    ...(cwd.length <= 520 ? { cwd } : {}),
    env: vars,
  };
}
