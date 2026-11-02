import { describe, expect, it } from 'vitest';
import { DEFAULT_MONITORING } from '@examguard/shared';
import { classifyEvent, LONG_OUTSIDE_MS, SHORT_SWITCH_MS, type ClassifyInput } from './classify.js';

const rate = (
  type: string,
  details: Record<string, unknown> = {},
  over: Partial<ClassifyInput> = {},
) =>
  classifyEvent({ type, details, highSeverityApps: DEFAULT_MONITORING.highSeverityApps, ...over });

describe('classifyEvent: leaving the exam', () => {
  it('rates Chrome in focus high and a switch to Notepad low at first', () => {
    expect(rate('focus_lost', { exe: 'chrome.exe', title: 'ChatGPT' })).toBe('high');
    expect(rate('focus_lost', { exe: 'notepad.exe' })).toBe('low');
  });

  it('matches the teacher list in any letter case and ignores an exe that is not text', () => {
    const apps = ['WhatsApp.exe'];
    expect(rate('focus_lost', { exe: 'whatsapp.EXE' }, { highSeverityApps: apps })).toBe('high');
    expect(rate('focus_lost', { exe: 5 }, { highSeverityApps: ['5'] })).toBe('low');
  });

  it('rates the return by how long the student was away', () => {
    expect(rate('focus_returned', { durationMs: SHORT_SWITCH_MS - 1 })).toBe('low');
    expect(rate('focus_returned', { durationMs: SHORT_SWITCH_MS })).toBe('medium');
    expect(rate('focus_returned', { durationMs: LONG_OUTSIDE_MS })).toBe('high');
    // Coming back from a listed program is not the offence; the switch already was.
    expect(rate('focus_returned', { exe: 'chrome.exe', durationMs: 3000 })).toBe('low');
    expect(rate('focus_returned', {})).toBe('low');
  });

  it('raises the shots taken while away with the time outside', () => {
    expect(rate('still_outside', { exe: 'notepad.exe' }, { outsideMs: 20_000 })).toBe('medium');
    expect(rate('still_outside', { exe: 'notepad.exe' }, { outsideMs: LONG_OUTSIDE_MS })).toBe(
      'high',
    );
    expect(rate('title_changed', { exe: 'notepad.exe' }, { outsideMs: 2000 })).toBe('low');
    expect(rate('title_changed', { exe: 'notepad.exe' })).toBe('low');
    expect(rate('title_changed', { exe: 'msedge.exe' }, { outsideMs: 1000 })).toBe('high');
  });
});

describe('classifyEvent: other evidence', () => {
  it('rates a started program medium, or high when the teacher listed it', () => {
    expect(rate('app_launched', { exe: 'notepad.exe' })).toBe('medium');
    expect(
      rate('app_launched', { exe: 'Discord.exe' }, { highSeverityApps: ['discord.exe'] }),
    ).toBe('high');
  });

  it('rates the start list medium only when a listed program is running', () => {
    expect(rate('processes_at_start', { processes: [] })).toBe('low');
    expect(rate('processes_at_start', { processes: [{ exe: 'notepad.exe', pid: 1 }] })).toBe('low');
    expect(rate('processes_at_start', { processes: [{ exe: 'Telegram.exe', pid: 2 }, null] })).toBe(
      'medium',
    );
    expect(rate('processes_at_start', { processes: 'chrome.exe' })).toBe('low');
  });

  it('rates screens: plugged in mid-exam high, two at the start medium, one removed low', () => {
    expect(rate('monitor_changed', { monitors: 2, monitorsBefore: 1 })).toBe('high');
    expect(rate('monitor_changed', { monitors: 2 })).toBe('medium');
    expect(rate('monitor_changed', { monitors: 1, monitorsBefore: 2 })).toBe('low');
    expect(rate('monitor_changed', { monitors: 1 })).toBe('low');
  });

  it('rates the fixed types from requirements §8.6', () => {
    for (const type of [
      'taskmgr_opened',
      'secure_desktop',
      'app_relaunched',
      'paste_blocked',
      'network_lost',
    ]) {
      expect(rate(type), type).toBe('medium');
    }
    expect(rate('large_insertion', { chars: 300 })).toBe('high');
    expect(rate('agent_lost')).toBe('critical');
    expect(rate('duplicate_login')).toBe('critical');
    for (const type of [
      'run_executed',
      'terminal_command',
      'network_restored',
      'internet_blocked',
    ]) {
      expect(rate(type), type).toBe('low');
    }
  });
});
