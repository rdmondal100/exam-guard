import { spawn } from 'node-pty';
import type { PtySpawn } from './terminal-host.js';

/**
 * node-pty (ConPTY). `useConptyDll` uses the conpty.dll + OpenConsole.exe shipped with node-pty:
 * its kill closes the pseudoconsole directly, while the system ConPTY path forks a helper that
 * races the exiting shell. Both must stay outside the asar when packaging (M45).
 */
export const spawnPty: PtySpawn = (launch, size) => {
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
