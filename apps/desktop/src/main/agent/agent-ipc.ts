import { join } from 'node:path';
import { app, ipcMain, shell } from 'electron';
import type { AgentChangeResult, AgentServiceStatus } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import { resolveAgentExe } from './agent-exe.js';
import type { AgentLink } from './agent-link.js';
import { isFakeAgent } from './create-agent-link.js';
import { installAgent, uninstallAgent } from './agent-installer.js';
import { runCommand } from './run-command.js';
import { queryAgentService } from './service-state.js';
import { readReport, spikeDir } from './spike-report.js';

interface Deps {
  userData: string;
  link: AgentLink;
  requireStudent: () => void;
}

/**
 * Student mode: tells the renderer whether the agent service is running and can set it up (one
 * UAC prompt) from inside the app. `EG_FAKE_AGENT=1` in a dev build skips all of it.
 */
export function registerAgentIpc(deps: Deps): void {
  const fake = isFakeAgent({
    isPackaged: app.isPackaged,
    env: process.env,
    appVersion: app.getVersion(),
  });
  const exeEnv = () => ({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    env: process.env,
  });
  const installer = { run: runCommand, workDir: join(deps.userData, 'agent-setup') };

  const status = async (message?: string): Promise<AgentServiceStatus> => {
    const exeFound = resolveAgentExe(exeEnv()) !== null;
    const canUninstall = !app.isPackaged;
    const link = deps.link.status();
    if (fake) return { state: 'running', link, exeFound, fake, canUninstall };
    // A verified pipe means the service is up; only otherwise is it worth asking the SCM why not.
    const state = link.verified ? 'running' : await queryAgentService(runCommand);
    return { state, link, exeFound, fake, canUninstall, ...(message ? { message } : {}) };
  };
  const change = async (error: string | null): Promise<AgentChangeResult> => ({
    ok: error === null,
    ...(error ? { error } : {}),
    status: await status(error ?? undefined),
  });

  ipcMain.handle(IPC.agentStatus, () => {
    deps.requireStudent();
    return status();
  });
  ipcMain.handle(IPC.agentInstall, async () => {
    deps.requireStudent();
    if (fake) return change(null);
    const exe = resolveAgentExe(exeEnv());
    if (!exe) {
      return change('eg-agent.exe was not found. Run "cargo build -p eg-agent --release" first.');
    }
    return change(
      await installAgent(exe, installer, app.isPackaged ? undefined : process.execPath),
    );
  });
  ipcMain.handle(IPC.agentUninstall, async () => {
    deps.requireStudent();
    if (fake || app.isPackaged) return change(null);
    return change(await uninstallAgent(installer));
  });
  ipcMain.handle(IPC.agentReport, () => {
    deps.requireStudent();
    return readReport(spikeDir(process.env));
  });
  ipcMain.handle(IPC.agentOpenShots, async () => {
    deps.requireStudent();
    await shell.openPath(spikeDir(process.env));
  });
}
