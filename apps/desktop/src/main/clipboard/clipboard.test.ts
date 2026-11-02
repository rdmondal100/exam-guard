import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PasteBlockedReport, SessionState } from '@examguard/shared';
import { ClipboardClear } from './clipboard-clear.js';
import { ThrottledReporter } from './throttled-reporter.js';

const exam = (over: Partial<SessionState> = {}): SessionState => ({
  examState: 'running',
  studentState: 'active',
  deadline: 1,
  saved: [],
  locked: false,
  monitoring: true,
  terminal: { enabled: false, until: null },
  internet: 'allowed',
  filesEnabled: true,
  examFiles: [],
  ...over,
});

describe('ClipboardClear', () => {
  it('clears once when the student starts working, and again after a new start', () => {
    let clears = 0;
    const clip = new ClipboardClear(() => clears++);
    clip.onExam(exam({ examState: 'hosting', studentState: 'lobby' }));
    expect(clears).toBe(0);
    clip.onExam(exam());
    clip.onExam(exam({ locked: true, studentState: 'locked' }));
    clip.onExam(exam());
    expect(clears).toBe(1);
    clip.onExam(exam({ studentState: 'submitted' }));
    clip.onExam(exam());
    expect(clears).toBe(2);
    clip.reset();
    clip.onExam(exam());
    expect(clears).toBe(3);
  });

  it('does nothing without an exam', () => {
    let clears = 0;
    new ClipboardClear(() => clears++).onExam(null);
    expect(clears).toBe(0);
  });
});

describe('ThrottledReporter', () => {
  afterEach(() => vi.useRealTimers());
  const report = (chars: number): PasteBlockedReport => ({
    surface: 'editor',
    chars,
    lines: 1,
    preview: 'x',
  });

  it('sends the first block at once and folds the next ones into one event per window', () => {
    vi.useFakeTimers();
    const sent: PasteBlockedReport[] = [];
    const reporter = new ThrottledReporter<PasteBlockedReport>((d) => sent.push(d), 2000);
    reporter.report(report(1));
    reporter.report(report(2));
    reporter.report(report(3));
    reporter.report(report(4));
    expect(sent).toEqual([report(1)]);
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual([report(1), { ...report(4), suppressed: 2 }]);
    reporter.report(report(5));
    vi.advanceTimersByTime(2000);
    expect(sent.at(-1)).toEqual(report(5));
    vi.advanceTimersByTime(2000);
    reporter.report(report(6));
    expect(sent.at(-1)).toEqual(report(6));
    expect(sent).toHaveLength(4);
    reporter.dispose();
  });
});
