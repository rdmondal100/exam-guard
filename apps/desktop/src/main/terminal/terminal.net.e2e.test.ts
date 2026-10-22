import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveToolchain } from '../runner/toolchains.js';
import { spawnPty } from './pty.js';
import { TerminalHost } from './terminal-host.js';
import { prepareTerminal } from './terminal-launch.js';

// The M15a acceptance run through the real terminal: npm and pacman installs from the internet,
// then a GLUT program built with plain `gcc` and run for a moment (a window opens briefly).
// Opt in with EG_NET_E2E=1 after `pnpm fetch-toolchains` and `cargo build -p eg-runner`.
const tools = resolveToolchain({
  isPackaged: false,
  appPath: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
  resourcesPath: '',
  execPath: process.execPath,
  env: process.env,
});
const ready =
  process.env.EG_NET_E2E === '1' &&
  !!tools.runner &&
  !!tools.msysRoot &&
  !!tools.npmCli &&
  !!tools.mingwBin;
const root = mkdtempSync(join(tmpdir(), 'eg-term net-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const shell = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

const CUBE = `#include <GL/glut.h>
#include <stdio.h>
#include <stdlib.h>
static int frames = 30;
static void display(void) { glClear(GL_COLOR_BUFFER_BIT); glutWireCube(1); glutSwapBuffers(); }
static void tick(int v) { (void)v; if (--frames <= 0) { printf("cube-done\\n"); exit(0); } glutPostRedisplay(); glutTimerFunc(16, tick, 0); }
int main(int argc, char **argv) {
  glutInit(&argc, argv); glutInitDisplayMode(GLUT_DOUBLE | GLUT_RGB); glutCreateWindow("cube");
  glutDisplayFunc(display); glutTimerFunc(16, tick, 0); glutMainLoop(); return 0;
}
`;

describe.skipIf(!ready)('exam terminal installs packages (network)', () => {
  it('npm i, pacman -S, then a GLUT build from the terminal', async () => {
    let output = '';
    const host = new TerminalHost({
      spawn: spawnPty,
      onData: (d) => (output += d),
      onExit: () => {},
      flushMs: 5,
    });
    host.open(() => prepareTerminal({ runRoot: root, tools, baseEnv: process.env, shell }), {
      cols: 200,
      rows: 50,
    });
    writeFileSync(join(root, 'workspace', 'cube.c'), CUBE);
    const step = async (command: string, marker: string, ms: number) => {
      host.write(`${command}; "${marker}" + (6*7)\r`);
      const until = Date.now() + ms;
      while (!output.includes(`${marker}42`) && Date.now() < until)
        await new Promise((r) => setTimeout(r, 100));
      expect(output, output.slice(-3000)).toContain(`${marker}42`);
    };
    try {
      await step('npm i lodash', 'npm', 120_000);
      await step(`node -e "console.log('lodash=' + require('lodash').VERSION)"`, 'lodash', 20_000);
      expect(output).toMatch(/lodash=\d+\.\d+\.\d+/);
      await step('pacman -S --noconfirm mingw-w64-ucrt-x86_64-freeglut', 'pacman', 180_000);
      await step(
        'gcc cube.c -o cube.exe -lfreeglut -lopengl32 -lglu32; .\\cube.exe',
        'cube',
        60_000,
      );
      expect(output).toContain('cube-done');
    } finally {
      host.close();
    }
  }, 400_000);
});
