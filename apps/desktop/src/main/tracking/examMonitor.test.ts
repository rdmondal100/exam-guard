import { describe, expect, it } from 'vitest';
import type { MonitorPolicy, SessionState } from '@examguard/shared';
import { ExamMonitor, wantsMonitoring, type MonitorSession } from './examMonitor.js';

const POLICY: MonitorPolicy = {
  screenshotOnSwitch: true,
  titleChangeShots: true,
  periodicOutsideSec: 20,
  minShotGapSec: 5,
  maxWidth: 1600,
  jpegQuality: 60,
};

const state = (over: Partial<SessionState> = {}): SessionState =>
  ({
    examState: 'running',
    studentState: 'active',
    deadline: 1,
    saved: [],
    locked: false,
    monitoring: true,
    monitoringPolicy: POLICY,
    terminal: { enabled: false, until: null },
    filesEnabled: true,
    examFiles: [],
    ...over,
  }) as SessionState;

function setup(student: string | null = 'es1') {
  const calls: string[] = [];
  const sent: Parameters<MonitorSession['sendEvidence']>[0][] = [];
  const monitor = new ExamMonitor(
    { start: (p) => calls.push(`start ${p.periodicOutsideSec}`), stop: () => calls.push('stop') },
    { examStudentId: () => student, sendEvidence: (e) => sent.push(e) },
    'run1',
  );
  return { monitor, calls, sent };
}

describe('wantsMonitoring', () => {
  it('watches an active or locked student of a running exam until the receipt', () => {
    expect(wantsMonitoring(state())).toBe(true);
    expect(wantsMonitoring(state({ studentState: 'locked' }))).toBe(true);
    expect(wantsMonitoring(state({ examState: 'hosting' }))).toBe(false);
    expect(wantsMonitoring(state({ studentState: 'submitted' }))).toBe(false);
    expect(wantsMonitoring(state({ monitoring: false }))).toBe(false);
  });
});

describe('ExamMonitor', () => {
  it('starts once per policy and stops when the exam no longer wants it', () => {
    const t = setup();
    t.monitor.onExam(state());
    t.monitor.onExam(state());
    t.monitor.onExam(state({ monitoringPolicy: { ...POLICY, periodicOutsideSec: 30 } }));
    t.monitor.onExam(state({ studentState: 'submitted' }));
    t.monitor.onExam(state({ studentState: 'submitted' }));
    expect(t.calls).toEqual(['start 20', 'start 30', 'stop']);
  });

  it('does not start before the student has joined', () => {
    const t = setup(null);
    t.monitor.onExam(state());
    expect(t.calls).toEqual([]);
  });

  it('keys each piece of evidence by student, app run and number', () => {
    const t = setup();
    t.monitor.onExam(state());
    const jpeg = new Uint8Array([1]);
    t.monitor.evidence({ kind: 'focus_lost', ts: 5, details: { exe: 'chrome.exe' }, jpeg });
    t.monitor.evidence({ kind: 'focus_returned', ts: 6, details: { durationMs: 1 } });
    expect(t.sent).toEqual([
      { key: 'es1:run1:1', type: 'focus_lost', clientTs: 5, details: { exe: 'chrome.exe' }, jpeg },
      { key: 'es1:run1:2', type: 'focus_returned', clientTs: 6, details: { durationMs: 1 } },
    ]);
  });

  it('still sends what was seen just before a stop, but nothing after the session ended', () => {
    const t = setup();
    t.monitor.onExam(state());
    t.monitor.onExam(state({ examState: 'ended' }));
    t.monitor.evidence({ kind: 'focus_lost', ts: 1, details: {} });
    expect(t.sent).toHaveLength(1);
    t.monitor.reset();
    t.monitor.evidence({ kind: 'focus_lost', ts: 2, details: {} });
    expect(t.sent).toHaveLength(1);
  });
});
