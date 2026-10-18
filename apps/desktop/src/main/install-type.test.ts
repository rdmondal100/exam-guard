import { describe, expect, it } from 'vitest';
import { parseRegQueryOutput, readInstallType } from './install-type.js';

const out = (v: string) =>
  `\r\nHKEY_LOCAL_MACHINE\\Software\\ExamGuard\r\n    InstallType    REG_SZ    ${v}\r\n`;

describe('parseRegQueryOutput', () => {
  it('reads teacher and student, any case', () => {
    expect(parseRegQueryOutput(out('teacher'))).toBe('teacher');
    expect(parseRegQueryOutput(out('Student'))).toBe('student');
  });
  it('falls back to dev for garbage or missing values', () => {
    expect(parseRegQueryOutput(out('lab'))).toBe('dev');
    expect(parseRegQueryOutput('ERROR: not found')).toBe('dev');
    expect(parseRegQueryOutput('')).toBe('dev');
  });
});

describe('readInstallType override', () => {
  it('is honoured when unpackaged', async () => {
    expect(await readInstallType({ override: 'student', isPackaged: false })).toBe('student');
  });
});
