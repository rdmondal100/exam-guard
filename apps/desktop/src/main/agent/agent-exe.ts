import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface AgentExeEnv {
  isPackaged: boolean;
  /** `app.getAppPath()`: `apps/desktop` in dev. */
  appPath: string;
  /** `process.resourcesPath` of a packaged app. */
  resourcesPath: string;
  env: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

/**
 * Finds `eg-agent.exe`. Dev: `EG_AGENT_PATH`, then the Cargo `target` folder. Packaged: next to the
 * app resources (final layout in M45; the override is ignored there).
 */
export function resolveAgentExe(t: AgentExeEnv): string | null {
  const exists = t.exists ?? existsSync;
  const candidates = t.isPackaged
    ? [join(t.resourcesPath, 'eg-agent.exe')]
    : [
        t.env.EG_AGENT_PATH,
        join(resolve(t.appPath, '..', '..'), 'target', 'release', 'eg-agent.exe'),
        join(resolve(t.appPath, '..', '..'), 'target', 'debug', 'eg-agent.exe'),
      ];
  return candidates.find((p): p is string => !!p && exists(p)) ?? null;
}
