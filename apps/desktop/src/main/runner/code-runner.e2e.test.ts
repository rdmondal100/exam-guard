import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { QuestionLanguage } from '@examguard/shared';
import { CodeRunner } from './code-runner.js';
import { resolveToolchain } from './toolchains.js';

// Real eg-runner (`cargo build -p eg-runner`) and MinGW (`pnpm fetch-toolchains`). Skipped when
// either is missing. Node stands in for Electron-as-Node.
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
const runner = new CodeRunner({ toolchain: () => tools, workRoot: () => root, now: () => clock });
const run = (language: QuestionLanguage, code: string, stdin = '') => {
  clock += 10_000; // skip the cooldown
  return runner.run({ questionId: `q${clock}`, language, code, stdin });
};

describe.skipIf(!tools.runner || !tools.mingwBin)('CodeRunner with eg-runner and gcc', () => {
  it('runs C with stdin', async () => {
    const r = await run(
      'c',
      '#include <stdio.h>\nint main(void){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 4;}',
      '2 3',
    );
    // C stdout is in text mode on Windows.
    expect(r).toMatchObject({ status: 'ok', stdout: '5\r\n', exitCode: 4 });
  });

  it('runs C++17', async () => {
    const r = await run(
      'cpp',
      '#include <iostream>\n#include <optional>\nint main(){std::optional<int> x{7};std::cout<<*x;}',
    );
    expect(r).toMatchObject({ status: 'ok', stdout: '7', exitCode: 0 });
  });

  it('runs JavaScript', async () => {
    const r = await run('js', 'console.log([1,2,3].map(x => x * 2).join(","))');
    expect(r).toMatchObject({ status: 'ok', stdout: '2,4,6\n', exitCode: 0 });
  });

  it('underlines a syntax error', async () => {
    const r = await run('c', 'int main(void){\n  return 0\n}\n');
    expect(r.status).toBe('compile_error');
    expect(r.diagnostics.some((d) => d.severity === 'error' && d.line >= 2)).toBe(true);
  });

  it('stops an endless loop at 5 s', async () => {
    const r = await run('c', 'int main(void){volatile int x=0;for(;;)x++;}');
    expect(r.status).toBe('time_limit');
  }, 20_000);

  it('refuses a 1 GB allocation', async () => {
    const r = await run(
      'cpp',
      // Reads an element back, or -O2 may drop the unused allocation altogether.
      '#include <vector>\n#include <cstdio>\n#include <cstdlib>\nint main(){std::vector<char> v(1u<<30, 1);std::printf("allocated %d", v[std::rand() % v.size()]);}',
    );
    expect(r.status).toBe('memory_limit');
    expect(r.stdout).not.toContain('allocated');
  }, 20_000);

  it('caps output at 64 KB', async () => {
    const r = await run('c', '#include <stdio.h>\nint main(void){for(;;)puts("spam");}');
    expect(r.status).toBe('output_limit');
    expect(r.stdout.length).toBeLessThanOrEqual(64 * 1024);
  }, 20_000);

  it('contains a fork loop', async () => {
    const r = await run(
      'c',
      '#include <stdlib.h>\nint main(int c,char**v){(void)c;for(int i=0;i<20;i++)system(v[0]);return 0;}',
    );
    expect(r.status).toBe('process_limit');
  }, 20_000);
});
