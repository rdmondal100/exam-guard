import { describe, expect, it } from 'vitest';
import { PipeLaunchSchema } from '@examguard/shared';
import { launchInfo } from './launch-info.js';

describe('launchInfo', () => {
  it('keeps the arguments after the program, the folder and only ExamGuard/Electron variables', () => {
    const info = launchInfo(['C:\\electron.exe', '.', '--profile', 'student'], 'E:\\app', {
      EG_FAKE_AGENT: '0',
      EG_AGENT_CONSOLE: '1',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      ELECTRON_RUN_AS_NODE: '1',
      PATH: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\x',
    });
    expect(info).toEqual({
      args: ['.', '--profile', 'student'],
      cwd: 'E:\\app',
      env: {
        EG_FAKE_AGENT: '0',
        EG_AGENT_CONSOLE: '1',
        ELECTRON_RENDERER_URL: 'http://localhost:5173',
      },
    });
    expect(PipeLaunchSchema.safeParse(info).success).toBe(true);
  });

  it('stays inside the pipe limits', () => {
    const env = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`EG_V${i}`, 'x']));
    const argv = ['exe', ...Array.from({ length: 40 }, () => 'a'), 'b'.repeat(3000)];
    const info = launchInfo(argv, 'c'.repeat(600), env);
    expect(PipeLaunchSchema.safeParse(info).success).toBe(true);
    expect(info.cwd).toBeUndefined();
    expect(Object.keys(info.env)).toHaveLength(32);
  });
});
