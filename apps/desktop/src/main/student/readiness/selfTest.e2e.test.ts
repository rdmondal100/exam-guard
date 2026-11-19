import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveToolchain } from '../../runner/toolchains.js';
import { runSelfTest } from './selfTest.js';

// The real bundled toolchains (`pnpm fetch-toolchains`); skipped when MinGW is missing. Node stands
// in for Electron-as-Node.
const tools = resolveToolchain({
  isPackaged: false,
  appPath: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'),
  resourcesPath: '',
  execPath: process.execPath,
  env: process.env,
});
const root = mkdtempSync(join(tmpdir(), 'eg-selftest-e2e-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(!tools.mingwBin || !tools.pythonExe)(
  'lobby self-test with the real toolchains',
  () => {
    it('compiles and runs C, C++, Python and JavaScript on this PC', async () => {
      const report = await runSelfTest({ tools, workDir: join(root, 'w'), env: process.env });
      expect(report.checks.filter((c) => !c.ok)).toEqual([]);
      expect(report.checks.map((c) => c.name)).toEqual(['c', 'cpp', 'python', 'js', 'disk']);
    }, 90_000);
  },
);
