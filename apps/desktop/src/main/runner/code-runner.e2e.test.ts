import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { QuestionLanguage, RunRequest } from '@examguard/shared';
import { spawnPtyProcess } from '../terminal/pty.js';
import { CodeRunner } from './code-runner.js';
import { resolveToolchain } from './toolchains.js';

// Real eg-runner (`cargo build -p eg-runner`), MinGW (`pnpm fetch-toolchains`) and a real pty.
// Skipped when either tool is missing. Node stands in for Electron-as-Node.
const tools = resolveToolchain({
  isPackaged: false,
  appPath: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
  resourcesPath: '',
  execPath: process.execPath,
  env: process.env,
});
const root = mkdtempSync(join(tmpdir(), 'eg-e2e-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let clock = 0;
const shown: string[] = [];
// Every run is in a real pseudo-console. The wall time is shortened so the endless loop ends soon.
const runner = new CodeRunner({
  toolchain: () => tools,
  workRoot: () => root,
  openPty: spawnPtyProcess,
  onData: (d) => shown.push(d),
  runTimeMs: 3000,
  now: () => clock,
});
const run = (language: QuestionLanguage, code: string, extra: Partial<RunRequest> = {}) => {
  clock += 10_000; // skip the cooldown
  shown.length = 0;
  return runner.run({ questionId: `q${clock}`, language, code, flags: '', ...extra });
};
const waitFor = async (text: string) => {
  for (let i = 0; i < 100; i++) {
    if (shown.join('').includes(text)) return;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`never saw "${text}", got: ${JSON.stringify(shown.join(''))}`);
};

describe.skipIf(!tools.runner || !tools.mingwBin)(
  'CodeRunner with eg-runner, gcc and a pty',
  () => {
    it('runs C and reports the exit code', async () => {
      const r = await run('c', '#include <stdio.h>\nint main(void){printf("hi");return 4;}');
      expect(r).toMatchObject({ status: 'ok', exitCode: 4 });
      expect(r.stdout).toContain('hi');
    });

    it('runs C++17', async () => {
      const r = await run(
        'cpp',
        '#include <iostream>\n#include <optional>\nint main(){std::optional<int> x{7};std::cout<<*x;}',
      );
      expect(r).toMatchObject({ status: 'ok', exitCode: 0 });
      expect(r.stdout).toContain('7');
    });

    it('runs JavaScript', async () => {
      const r = await run('js', 'console.log([1,2,3].map(x => x * 2).join(","))');
      expect(r).toMatchObject({ status: 'ok', exitCode: 0 });
      expect(r.stdout).toContain('2,4,6');
    });

    it('a scanf menu loop takes input while it runs', async () => {
      const running = run(
        'c',
        '#include <stdio.h>\nint main(void){int n,sum=0;for(;;){printf("n> ");fflush(stdout);if(scanf("%d",&n)!=1||n==0)break;sum+=n;}printf("sum=%d\\n",sum);return 3;}',
      );
      await waitFor('n> ');
      runner.write('5\r');
      await waitFor('5');
      runner.write('7\r');
      runner.write('0\r');
      const r = await running;
      expect(r).toMatchObject({ status: 'ok', exitCode: 3 });
      expect(r.stdout).toContain('sum=12');
    }, 30_000);

    it('underlines a syntax error', async () => {
      const r = await run('c', 'int main(void){\n  return 0\n}\n');
      expect(r.status).toBe('compile_error');
      expect(r.diagnostics.some((d) => d.severity === 'error' && d.line >= 2)).toBe(true);
    });

    it('ends an endless loop at the wall time (shortened here)', async () => {
      const r = await run('c', 'int main(void){volatile int x=0;for(;;)x++;}');
      expect(r.status).toBe('time_limit');
      expect(r.message).toMatch(/longer than 3 s/);
    }, 30_000);

    it('refuses a 1 GB allocation', async () => {
      const r = await run(
        'cpp',
        // Reads an element back, or -O2 may drop the unused allocation altogether.
        '#include <vector>\n#include <cstdio>\n#include <cstdlib>\nint main(){std::vector<char> v(1u<<30, 1);std::printf("allocated %d", v[std::rand() % v.size()]);}',
      );
      expect(r.status).toBe('memory_limit');
      expect(r.stdout).not.toContain('allocated');
    }, 30_000);

    it('caps output at 64 KB', async () => {
      const r = await run('c', '#include <stdio.h>\nint main(void){for(;;)puts("spam");}');
      expect(r.status).toBe('output_limit');
      expect(r.stdout.length).toBeLessThanOrEqual(64 * 1024);
    }, 30_000);

    it('contains a fork loop', async () => {
      const r = await run(
        'c',
        '#include <stdlib.h>\nint main(int c,char**v){(void)c;for(int i=0;i<20;i++)system(v[0]);return 0;}',
      );
      expect(r.status).toBe('process_limit');
    }, 30_000);

    it("links with the student's flags, placed after the source", async () => {
      const r = await run(
        'c',
        '#include <stdio.h>\n#include <math.h>\nint main(void){volatile double x=16;printf("%g",sqrt(x));return 0;}',
        { flags: '-lm' },
      );
      expect(r.status).toBe('ok');
      expect(r.stdout).toContain('4');
    });

    it('lets a student -std= override ours', async () => {
      const code = 'int main(void){for(int i=0;i<1;i++){}return 0;}';
      const strict = await run('c', code, { flags: '-std=c89 -pedantic-errors' });
      expect(strict.status).toBe('compile_error');
      expect((await run('c', code, { flags: '-std=c99' })).status).toBe('ok');
    });

    it('finds headers dropped into the workspace', async () => {
      mkdirSync(join(root, 'workspace', 'include'), { recursive: true });
      writeFileSync(
        join(root, 'workspace', 'include', 'mylib.h'),
        'static int twice(int x){return 2*x;}',
      );
      const r = await run(
        'c',
        '#include <stdio.h>\n#include <mylib.h>\nint main(void){printf("%d",twice(21));return 0;}',
      );
      expect(r.status).toBe('ok');
      expect(r.stdout).toContain('42');
    });

    it('a Win32 window program started from the console stays up until Stop', async () => {
      // Returns at once if the window cannot be created, so living for 2 s means it opened.
      const code = [
        '#include <windows.h>',
        'LRESULT CALLBACK P(HWND h,UINT m,WPARAM w,LPARAM l){if(m==WM_DESTROY)PostQuitMessage(0);return DefWindowProc(h,m,w,l);}',
        'int main(void){WNDCLASS c={0};c.lpfnWndProc=P;c.hInstance=GetModuleHandle(0);c.lpszClassName="eg";RegisterClass(&c);',
        'HWND h=CreateWindow("eg","t",WS_OVERLAPPEDWINDOW|WS_VISIBLE,0,0,200,120,0,0,c.hInstance,0);if(!h)return 9;',
        'MSG m;while(GetMessage(&m,0,0,0)>0){TranslateMessage(&m);DispatchMessage(&m);}return 0;}',
      ].join('\n');
      const running = run('c', code, { flags: '-luser32' });
      const early = await Promise.race([
        running,
        new Promise((res) => setTimeout(() => res('up'), 2000)),
      ]);
      expect(early).toBe('up');
      runner.stop();
      expect((await running).status).toBe('stopped');
    }, 30_000);

    it('Stop ends a program that waits for input', async () => {
      const running = run(
        'c',
        '#include <stdio.h>\nint main(void){int n;scanf("%d",&n);return 0;}',
      );
      await new Promise((res) => setTimeout(res, 1500));
      runner.stop();
      expect((await running).status).toBe('stopped');
    }, 30_000);
  },
);

// The app runs JavaScript on Electron-as-Node, whose stdin is not a console by itself (js-stdin.ts).
// Node above can't show that, so this one needs the real Electron executable from node_modules.
const electronExe = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'node_modules',
  'electron',
  'dist',
  'electron.exe',
);
describe.skipIf(!tools.runner || !existsSync(electronExe))(
  'JavaScript input on Electron-as-Node',
  () => {
    const electron = new CodeRunner({
      toolchain: () => ({ ...tools, nodeExe: electronExe }),
      workRoot: () => root,
      openPty: spawnPtyProcess,
      onData: (d) => shown.push(d),
      runTimeMs: 20_000,
      now: () => clock,
    });
    const readlineSum = [
      'const readline = require("readline");',
      'const rl = readline.createInterface({ input: process.stdin, output: process.stdout });',
      'rl.question("How many? ", (a) => {',
      '  let n = Number(a), sum = 0, i = 1;',
      '  const next = () => {',
      '    if (i > n) { console.log("Sum = " + sum); rl.close(); return; }',
      '    rl.question("Enter number " + i + ": ", (x) => { sum += Number(x); i++; next(); });',
      '  };',
      '  next();',
      '});',
    ].join('\n');

    it('readline.question takes typed answers', async () => {
      clock += 10_000;
      shown.length = 0;
      const running = electron.run({
        questionId: `e${clock}`,
        language: 'js',
        code: readlineSum,
        flags: '',
      });
      await waitFor('How many?');
      electron.write('2\r');
      await waitFor('Enter number 1');
      electron.write('5\r');
      await waitFor('Enter number 2');
      electron.write('7\r');
      const r = await running;
      expect(r).toMatchObject({ status: 'ok', exitCode: 0 });
      expect(r.stdout).toContain('Sum = 12');
    }, 60_000);

    it('a program that never reads input still ends by itself', async () => {
      clock += 10_000;
      shown.length = 0;
      const r = await electron.run({
        questionId: `e${clock}`,
        language: 'js',
        code: 'console.log("done")',
        flags: '',
      });
      expect(r).toMatchObject({ status: 'ok', exitCode: 0 });
      expect(r.stdout).toContain('done');
    }, 60_000);
  },
);
