import { describe, expect, it } from 'vitest';
import { placeholderSeverity } from './placeholder-severity.js';

describe('placeholderSeverity', () => {
  it('rates leaving the exam medium and the rest low', () => {
    expect(placeholderSeverity('focus_lost', { exe: 'chrome.exe' }, [])).toBe('medium');
    expect(placeholderSeverity('title_changed', { exe: 'chrome.exe' }, [])).toBe('low');
    expect(placeholderSeverity('still_outside', {}, [])).toBe('low');
    expect(placeholderSeverity('focus_returned', { durationMs: 5 }, [])).toBe('low');
  });

  it('rates the teachers high-severity programs high, in any letter case', () => {
    const apps = ['WhatsApp.exe'];
    expect(placeholderSeverity('focus_lost', { exe: 'whatsapp.EXE' }, apps)).toBe('high');
    expect(placeholderSeverity('title_changed', { exe: 'WhatsApp.exe' }, apps)).toBe('high');
    expect(placeholderSeverity('still_outside', { exe: 'WhatsApp.exe' }, apps)).toBe('high');
    // Coming back is not the offence.
    expect(placeholderSeverity('focus_returned', { exe: 'WhatsApp.exe' }, apps)).toBe('low');
  });

  it('rates a started program low, or high when the teacher listed it', () => {
    expect(placeholderSeverity('app_launched', { exe: 'notepad.exe' }, [])).toBe('low');
    expect(placeholderSeverity('app_launched', { exe: 'Discord.exe' }, ['discord.exe'])).toBe('high');
    expect(placeholderSeverity('processes_at_start', { processes: [] }, ['discord.exe'])).toBe('low');
  });

  it('ignores an exe that is not text', () => {
    expect(placeholderSeverity('focus_lost', { exe: 5 }, ['5'])).toBe('medium');
  });
});
