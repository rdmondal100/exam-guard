import { describe, expect, it, vi } from 'vitest';
import type { EventRow } from '@examguard/shared';
import { createExamApi } from '../api/examApi';
import { describeEvent, formatDuration, jpegDataUrl, programCounts } from './eventsView';

const event = (type: string, details: Record<string, unknown>): EventRow => ({
  id: 1,
  examStudentId: 's1',
  studentCode: '1',
  studentName: 'Ada',
  type,
  severity: 'medium',
  serverTs: 1,
  clientTs: 1,
  details,
  hasScreenshot: true,
});

describe('process watcher events', () => {
  it('says what was started and by whom', () => {
    expect(
      describeEvent(event('app_launched', { exe: 'notepad.exe', parentExe: 'explorer.exe' })),
    ).toBe('Started notepad.exe (from explorer.exe)');
    expect(describeEvent(event('app_launched', { exe: 'notepad.exe' }))).toBe(
      'Started notepad.exe',
    );
    expect(describeEvent(event('app_launched', {}))).toBe('Started a program');
  });

  it('counts the programs running at the start by name', () => {
    const processes = [
      { exe: 'Spotify.exe', pid: 1 },
      { exe: 'discord.exe', pid: 2 },
      { exe: 'discord.exe', pid: 3 },
      { exe: 7, pid: 4 },
    ];
    expect(programCounts({ processes })).toEqual([
      { exe: 'discord.exe', count: 2 },
      { exe: 'Spotify.exe', count: 1 },
    ]);
    expect(describeEvent(event('processes_at_start', { processes }))).toBe(
      'Running at the start: 2 programs',
    );
    expect(describeEvent(event('processes_at_start', { processes: [processes[0]] }))).toBe(
      'Running at the start: 1 program',
    );
  });

  it('copes with a missing or odd list', () => {
    expect(programCounts({})).toEqual([]);
    expect(programCounts({ processes: 'x' })).toEqual([]);
    expect(describeEvent(event('processes_at_start', {}))).toBe(
      'No programs were running at the start',
    );
  });
});

describe('formatDuration', () => {
  it('reads as seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(45_400)).toBe('45 s');
    expect(formatDuration(60_000)).toBe('1 min');
    expect(formatDuration(185_000)).toBe('3 min 5 s');
    expect(formatDuration(3_600_000)).toBe('1 h');
    expect(formatDuration(3_720_000)).toBe('1 h 2 min');
    expect(formatDuration(-5)).toBe('0 s');
  });
});

describe('describeEvent', () => {
  it('says what the student did in words', () => {
    const chrome = { exe: 'chrome.exe', title: 'Google' };
    expect(describeEvent(event('focus_lost', chrome))).toBe(
      'Left the exam for chrome.exe · Google',
    );
    expect(describeEvent(event('title_changed', chrome))).toBe('Now on chrome.exe · Google');
    expect(describeEvent(event('still_outside', chrome))).toBe(
      'Still outside, on chrome.exe · Google',
    );
    expect(describeEvent(event('focus_returned', { exe: 'chrome.exe', durationMs: 12_000 }))).toBe(
      'Came back after 12 s from chrome.exe',
    );
  });

  it('copes with missing details and unknown types', () => {
    expect(describeEvent(event('focus_lost', {}))).toBe('Left the exam for another window');
    expect(describeEvent(event('focus_returned', {}))).toBe('Came back');
    expect(describeEvent(event('run_executed', {}))).toBe('run_executed');
  });
});

describe('jpegDataUrl', () => {
  it('encodes bytes, also past one conversion step', () => {
    const small = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
    expect(jpegDataUrl(small)).toBe('data:image/jpeg;base64,/9j/');
    const big = new Uint8Array(0x8000 * 2 + 5).fill(65).buffer;
    const url = jpegDataUrl(big);
    expect(atob(url.slice('data:image/jpeg;base64,'.length))).toBe('A'.repeat(0x8000 * 2 + 5));
  });
});

const CONNECTION = { baseUrl: 'http://127.0.0.1:47821', token: 'tok' };

describe('examApi events and screenshots', () => {
  it('asks for the agent events with the filters and validates the answer', async () => {
    const row = event('focus_lost', { exe: 'chrome.exe' });
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ events: [row] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const events = await createExamApi(CONNECTION, fetchFn).events('e 1', {
      studentId: 's1',
      after: 7,
      limit: 50,
    });
    expect(events).toEqual([row]);
    expect(vi.mocked(fetchFn).mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:47821/api/v1/exams/e%201/events?view=monitoring&studentId=s1&after=7&limit=50',
    );
  });

  it('rejects an answer that is not a list of events', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ events: [{ id: 'x' }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(createExamApi(CONNECTION, fetchFn).events('e1')).rejects.toThrow();
  });

  it('fetches a screenshot with the token and returns a data URL', async () => {
    const fetchFn = vi.fn(
      async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 }),
    ) as unknown as typeof fetch;
    const url = await createExamApi(CONNECTION, fetchFn).screenshot(42);
    expect(url).toBe('data:image/jpeg;base64,/9j/');
    const [path, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(path).toBe('http://127.0.0.1:47821/api/v1/screenshots/42');
    expect(init?.headers).toMatchObject({ 'x-teacher-token': 'tok' });
  });

  it('rejects with the API error when the event has no screenshot', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'not_found', message: 'none' } }), {
          status: 404,
        }),
    ) as unknown as typeof fetch;
    await expect(createExamApi(CONNECTION, fetchFn).screenshot(1)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('tamper lock events (M24)', () => {
  it('describes a relaunch and a lost agent link', () => {
    expect(describeEvent(event('app_relaunched', { exe: 'ExamGuard.exe', pid: 4 }))).toBe(
      'ExamGuard was closed and the agent started it again',
    );
    expect(
      describeEvent(event('agent_lost', { reason: 'The monitoring agent stopped answering.' })),
    ).toBe('Monitoring agent lost, student locked: The monitoring agent stopped answering.');
    expect(describeEvent(event('agent_lost', {}))).toBe('Monitoring agent lost, student locked');
  });
});

describe('screens and Task Manager (M26)', () => {
  it('describes a screen change, screens at the start, the security screen and Task Manager', () => {
    expect(describeEvent(event('monitor_changed', { monitors: 2, monitorsBefore: 1 }))).toBe(
      'Screens changed: 1 → 2',
    );
    expect(describeEvent(event('monitor_changed', { monitors: 2 }))).toBe(
      '2 screens connected at the start',
    );
    expect(describeEvent(event('monitor_changed', {}))).toBe('Screens changed');
    expect(describeEvent(event('secure_desktop', { desktop: 'Winlogon' }))).toBe(
      'Security screen opened (Ctrl+Alt+Del, lock screen or UAC prompt)',
    );
    expect(describeEvent(event('secure_desktop', { desktop: 'Screen-saver' }))).toBe(
      'Another desktop took the screen: Screen-saver',
    );
    expect(describeEvent(event('secure_desktop', {}))).toBe(
      'Security screen opened (Ctrl+Alt+Del, lock screen or UAC prompt)',
    );
    expect(describeEvent(event('taskmgr_opened', { exe: 'Taskmgr.exe' }))).toBe(
      'Opened Task Manager',
    );
    expect(
      describeEvent(event('taskmgr_opened', { exe: 'Taskmgr.exe', parentExe: 'winlogon.exe' })),
    ).toBe('Opened Task Manager (from winlogon.exe)');
  });
});

describe('paste_blocked (M25)', () => {
  it('says how much was pasted where, with a short preview', () => {
    const details = {
      surface: 'editor',
      chars: 42,
      lines: 3,
      preview: 'def solve():\n    return 42',
    };
    expect(describeEvent(event('paste_blocked', details))).toBe(
      'Paste from outside the exam blocked (42 chars, 3 lines) in the code editor: "def solve(): return 42"',
    );
    const folded = { surface: 'other', chars: 1, lines: 1, preview: '', suppressed: 4 };
    expect(describeEvent(event('paste_blocked', folded))).toBe(
      'Paste from outside the exam blocked (+4 more) (1 chars, 1 line)',
    );
  });

  it('cuts a long preview', () => {
    const line = describeEvent(
      event('paste_blocked', { surface: 'answer', chars: 200, lines: 1, preview: 'a'.repeat(200) }),
    );
    expect(line).toContain(' in an answer box: "');
    expect(line.endsWith('…"')).toBe(true);
  });
});
