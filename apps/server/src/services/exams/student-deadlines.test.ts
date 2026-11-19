import { describe, expect, it } from 'vitest';
import type { ExamRepo, ExamTiming } from '../../db/repositories/exam.repo.js';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import { StudentDeadlines } from './student-deadlines.js';

const HOUR = 3_600_000;

function setup(timing: Partial<ExamTiming>, now: number) {
  const full: ExamTiming = {
    startedAt: 0,
    durationSec: 3600,
    globalExtensionSec: 0,
    graceSec: 10,
    pausedAt: null,
    pausedMs: 0,
    ...timing,
  };
  const exams = { timing: () => full } as unknown as ExamRepo;
  const students = {
    extensionSec: () => 0,
    maxExtensionSec: () => 0,
    working: () => [{ id: 's1', extensionSec: 0 }],
  } as unknown as ExamStudentRepo;
  return new StudentDeadlines(exams, students, () => now);
}

describe('StudentDeadlines with a pause (M58)', () => {
  it('moves every deadline by the finished pauses', () => {
    const d = setup({ pausedMs: 5000 }, 0);
    expect(d.forStudent('e', 's1')).toBe(HOUR + 5000);
    expect(d.effective('e', 's1')).toBe(HOUR + 5000);
  });

  it('keeps the shown deadline fixed while paused, and the enforced one moving', () => {
    const d = setup({ pausedAt: HOUR - 1000, pausedMs: 0 }, HOUR + 60_000);
    expect(d.forStudent('e', 's1')).toBe(HOUR);
    expect(d.effective('e', 's1')).toBe(HOUR + 61_000);
    expect(d.last('e')).toBe(HOUR + 61_000);
    // Past the shown deadline and its grace, but paused: nobody is auto-submitted.
    expect(d.overdue('e', HOUR + 60_000)).toEqual([]);
    expect(d.pausedAt('e')).toBe(HOUR - 1000);
  });
});

describe('StudentDeadlines after a restart (M62)', () => {
  it('waits for the apps to reconnect before anyone is auto-submitted', () => {
    const d = setup({}, 0);
    const late = HOUR + 10_000 + 30_000;
    expect(d.overdue('e', HOUR + 10_000)).toEqual(['s1']);
    d.allowLateUntil('e', late);
    expect(d.graceEnds('e', HOUR)).toBe(late);
    expect(d.overdue('e', HOUR + 10_000)).toEqual([]);
    expect(d.overdue('e', late)).toEqual(['s1']);
  });
});
