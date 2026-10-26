import { describe, expect, it } from 'vitest';
import { AgentToAppSchema, AppToAgentSchema } from './agent-pipe.js';
import { DEFAULT_MONITORING } from './exams.js';
import { monitorPolicyFor } from './events.js';
import { ReportedEventTypeSchema, EventReportSchema, isAgentEventType } from './ws.js';

const policy = monitorPolicyFor(DEFAULT_MONITORING);

describe('monitorPolicyFor', () => {
  it('maps the exam settings to the helper policy', () => {
    expect(policy).toEqual({
      screenshotOnSwitch: true,
      titleChangeShots: true,
      periodicOutsideSec: 20,
      minShotGapSec: 5,
      maxWidth: 1600,
      jpegQuality: 60,
    });
  });
});

describe('monitoring messages on the pipe', () => {
  it('accepts monitor.start with the policy, monitor.stop, exam.window and evidence.ack', () => {
    const start = { t: 'monitor.start', seq: 1, examStudentId: 's1', policy };
    expect(AppToAgentSchema.safeParse(start).success).toBe(true);
    expect(AppToAgentSchema.safeParse({ t: 'monitor.stop', seq: 2 }).success).toBe(true);
    expect(
      AppToAgentSchema.safeParse({ t: 'exam.window', seq: 3, hwnd: 66012, pid: 4100 }).success,
    ).toBe(true);
    expect(AppToAgentSchema.safeParse({ t: 'evidence.ack', seq: 4, upTo: 9 }).success).toBe(true);
  });

  it('rejects a monitor.start without a policy and an exam.window without a pid', () => {
    const start = { t: 'monitor.start', seq: 1, examStudentId: 's1' };
    expect(AppToAgentSchema.safeParse(start).success).toBe(false);
    expect(AppToAgentSchema.safeParse({ t: 'exam.window', seq: 3, hwnd: 5 }).success).toBe(false);
  });

  it('accepts evidence with and without a screenshot and rejects an unknown kind', () => {
    const evidence = {
      t: 'evidence',
      seq: 5,
      evidenceSeq: 1,
      ts: 1_700_000_000_000,
      kind: 'focus_lost',
      data: { exe: 'chrome.exe', title: 'Google', pid: 77 },
    };
    expect(AgentToAppSchema.safeParse(evidence).success).toBe(true);
    const withShot = {
      ...evidence,
      screenshot: { jpegBase64: '/9j/4AAQ', width: 800, height: 450 },
    };
    expect(AgentToAppSchema.safeParse(withShot).success).toBe(true);
    expect(AgentToAppSchema.safeParse({ ...evidence, kind: 'app_launched' }).success).toBe(false);
  });
});

describe('agent event reports', () => {
  it('lets an event carry an agent type and a screenshot reference', () => {
    const report = {
      t: 'event',
      id: 'a',
      dedupeKey: 'dev:1',
      clientTs: 1,
      type: 'focus_lost',
      details: { exe: 'chrome.exe' },
      screenshotRef: 'dev:1',
    };
    expect(EventReportSchema.safeParse(report).success).toBe(true);
    expect(ReportedEventTypeSchema.safeParse('run_executed').success).toBe(true);
    expect(ReportedEventTypeSchema.safeParse('app_launched').success).toBe(false);
    expect(isAgentEventType('title_changed')).toBe(true);
    expect(isAgentEventType('run_executed')).toBe(false);
  });
});
