import { describe, expect, it } from 'vitest';
import type { FrontWindow } from './foreground.js';
import { createInsideCheck, isUnder } from './inside.js';
import { OwnProcesses } from './ownProcesses.js';

const win = (pid: number, path: string): FrontWindow => ({
  exe: path.split('\\').at(-1) ?? '',
  path,
  pid,
  windowId: pid,
  title: '',
});

describe('isUnder', () => {
  it('compares Windows paths in any letter case, whole folder names only', () => {
    expect(isUnder('C:\\Run\\es1\\q1\\c\\main.exe', 'c:\\run')).toBe(true);
    expect(isUnder('C:\\Run\\es1\\main.exe', 'C:\\Run\\')).toBe(true);
    expect(isUnder('C:\\Runner\\main.exe', 'C:\\Run')).toBe(false);
    expect(isUnder('D:\\Run\\main.exe', 'C:\\Run')).toBe(false);
  });
});

describe('createInsideCheck', () => {
  it('counts the app, the student’s own programs and programs from the run or toolchain folders', () => {
    const own = new OwnProcesses();
    const inside = createInsideCheck({
      ownPid: 100,
      own,
      roots: () => ['C:\\Users\\s\\AppData\\Local\\ExamGuard\\run', null, 'C:\\EG\\toolchains'],
    });
    expect(inside(win(100, 'C:\\EG\\ExamGuard.exe'))).toBe(true);
    expect(inside(win(200, 'C:\\Chrome\\chrome.exe'))).toBe(false);

    own.set('run', 300);
    expect(inside(win(300, 'C:\\Windows\\System32\\notepad.exe'))).toBe(true);
    own.set('run', null);
    expect(inside(win(300, 'C:\\Windows\\System32\\notepad.exe'))).toBe(false);

    const glut = 'C:\\Users\\s\\AppData\\Local\\ExamGuard\\run\\es1\\workspace\\game.exe';
    expect(inside(win(400, glut))).toBe(true);
    expect(inside(win(500, 'C:\\EG\\toolchains\\python\\pythonw.exe'))).toBe(true);
  });
});
