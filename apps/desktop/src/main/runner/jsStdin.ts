/**
 * JavaScript runs on Electron's executable with `ELECTRON_RUN_AS_NODE`. That executable is a GUI
 * program with no console of its own, so under the run console `process.stdin` is a file stream
 * that reads end-of-file at once: `readline` and `process.stdin.on('data')` never get the typed
 * input, although `process.stdout` works. Opening `CONIN$` gives the real console input as a TTY,
 * with raw mode and echo like plain Node. Written next to the source as `eg-stdin.cjs` and loaded
 * with `-r`. Skipped when stdin is already a TTY (plain Node, tests) or there is no console.
 * The runner e2e test types into a real `readline` prompt on the Electron executable to catch a
 * regression.
 */
export const JS_STDIN_FILE = 'eg-stdin.cjs';

export const JS_STDIN = `const fs = require('fs');
const tty = require('tty');
if (process.platform === 'win32' && !tty.isatty(0)) {
  try {
    const stdin = new tty.ReadStream(fs.openSync('\\\\\\\\.\\\\CONIN$', 'r+'));
    // Like Node's own stdin: waiting for input keeps the program alive, a paused stdin (after
    // rl.close()) does not.
    stdin.on('pause', () => stdin.unref());
    stdin.on('resume', () => stdin.ref());
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      enumerable: true,
      get: () => stdin,
    });
  } catch {
    // No console: keep Node's own stdin.
  }
}
`;
