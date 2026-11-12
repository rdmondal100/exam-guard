import { describe, expect, it } from 'vitest';
import { cmdHostArgs, viaCmd } from './cmdHost.js';

describe('cmdHostArgs', () => {
  it('quotes every argument and wraps the whole for cmd /s', () => {
    expect(cmdHostArgs(['C:\\Program Files\\EG\\ExamGuard.exe', '-r', 'C:\\run\\a b.cjs'])).toBe(
      '/d /s /c ""C:\\Program Files\\EG\\ExamGuard.exe" "-r" "C:\\run\\a b.cjs""',
    );
  });

  it('refuses what cmd would read inside quotes, and an empty command', () => {
    expect(cmdHostArgs(['node.exe', '--title="x"'])).toBeNull();
    expect(cmdHostArgs(['node.exe', '%PATH%'])).toBeNull();
    expect(cmdHostArgs([])).toBeNull();
  });
});

describe('viaCmd', () => {
  it('runs the command line on cmd.exe', () => {
    expect(viaCmd('C:\\Windows\\system32\\cmd.exe', ['a.exe'])).toEqual({
      command: 'C:\\Windows\\system32\\cmd.exe',
      args: '/d /s /c ""a.exe""',
    });
  });
});
