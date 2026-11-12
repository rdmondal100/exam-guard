import { describe, expect, it } from 'vitest';
import { DEFAULT_MONITORING } from './exams.js';
import { monitorPolicyFor } from './events.js';
import {
  EvidenceDetailsSchema,
  isEvidenceKind,
  MAX_START_PROCESSES,
  MonitorPolicySchema,
} from './monitoring.js';
import { EventReportSchema, ReportedEventTypeSchema } from './ws.js';

const policy = monitorPolicyFor(DEFAULT_MONITORING);

describe('monitorPolicyFor', () => {
  it('maps the exam settings to the monitor policy', () => {
    expect(policy).toEqual({
      screenshotOnSwitch: true,
      titleChangeShots: true,
      periodicOutsideSec: 20,
      minShotGapSec: 5,
      maxWidth: 1600,
      jpegQuality: 60,
    });
    expect(MonitorPolicySchema.safeParse(policy).success).toBe(true);
  });
});

describe('evidence details', () => {
  it('accepts a browser switch with its site and a private window', () => {
    const site = {
      exe: 'chrome.exe',
      title: 'ChatGPT',
      pid: 77,
      domain: 'chatgpt.com',
      url: 'https://chatgpt.com/c/abc',
    };
    expect(EvidenceDetailsSchema.safeParse(site).success).toBe(true);
    const hidden = { exe: 'msedge.exe', privateWindow: true };
    expect(EvidenceDetailsSchema.safeParse(hidden).success).toBe(true);
  });

  it('caps the start list and wants a pid for each program', () => {
    const tooMany = { exe: 'a.exe', pid: 1 };
    const flood = { processes: Array(MAX_START_PROCESSES + 1).fill(tooMany) };
    expect(EvidenceDetailsSchema.safeParse(flood).success).toBe(false);
    expect(EvidenceDetailsSchema.safeParse({ processes: [{ exe: 'a.exe' }] }).success).toBe(false);
  });
});

describe('monitor event reports', () => {
  it('lets an event carry a monitor type and a screenshot reference', () => {
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
    expect(ReportedEventTypeSchema.safeParse('app_launched').success).toBe(true);
    expect(ReportedEventTypeSchema.safeParse('processes_at_start').success).toBe(true);
    expect(ReportedEventTypeSchema.safeParse('paste_blocked').success).toBe(true);
    expect(ReportedEventTypeSchema.safeParse('large_insertion').success).toBe(true);
    expect(ReportedEventTypeSchema.safeParse('duplicate_login').success).toBe(false);
    expect(ReportedEventTypeSchema.safeParse('agent_lost').success).toBe(false);
    expect(ReportedEventTypeSchema.safeParse('internet_blocked').success).toBe(false);
    expect(ReportedEventTypeSchema.safeParse('app_relaunched').success).toBe(false);
    expect(isEvidenceKind('app_launched')).toBe(true);
    expect(isEvidenceKind('title_changed')).toBe(true);
    expect(isEvidenceKind('run_executed')).toBe(false);
  });
});
