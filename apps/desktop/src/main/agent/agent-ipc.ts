import { join } from 'node:path';
import { app, ipcMain, shell } from 'electron';
import type { AgentChangeResult, AgentServiceStatus } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import { resolveAgentExe } from './agent-exe.js';
import { installAgent, uninstallAgent } from './agent-installer.js';
import { runCommand } from './run-command.js';
import { queryAgentService } from './service-state.js';
import { readReport, spikeDir } from './spike-report.js';

interface Deps {
  userData: string;
  requireStudent: () => void;
}

/**
 * Student mode: tells the renderer whether the agent service is running and can set it up (one
 * UAC prompt) from inside the app. `EG_FAKE_AGENT=1` in a dev build skips all of it.
 */
export function registerAgentIpc(deps: Deps): void {
  const fake = !app.isPackaged && process.env['EG_FAKE_AGENT'] === '1';
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
    if (fake) return { state: 'running', exeFound, fake, canUninstall };
    const state = await queryAgentService(runCommand);
    return { state, exeFound, fake, canUninstall, ...(message ? { message } : {}) };
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
    return change(await installAgent(exe, installer));
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
