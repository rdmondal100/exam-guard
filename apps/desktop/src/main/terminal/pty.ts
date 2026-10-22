import { spawn } from 'node-pty';
import type { PtyProcess, PtySpawn } from './terminal-host.js';

/** What a pty needs to start: the terminal's launch and an interactive run both fit it. */
export interface PtySpec {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export type PtyOpen = (spec: PtySpec, size: { cols: number; rows: number }) => PtyProcess;

/**
 * node-pty (ConPTY). `useConptyDll` uses the conpty.dll + OpenConsole.exe shipped with node-pty:
 * its kill closes the pseudoconsole directly, while the system ConPTY path forks a helper that
 * races the exiting shell. Both must stay outside the asar when packaging (M45).
 */
export const spawnPtyProcess: PtyOpen = (launch, size) => {
  const pty = spawn(launch.file, launch.args, {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd: launch.cwd,
    env: launch.env,
    useConptyDll: true,
  });
  return {
    onData: (listener) => void pty.onData(listener),
    onExit: (listener) => void pty.onExit((e) => listener(e.exitCode)),
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
  };
};

export const spawnPty: PtySpawn = spawnPtyProcess;
