import { describe, expect, it, vi } from 'vitest';
import type { EventRow } from '@examguard/shared';
import { createExamApi } from './examApi';
import { describeEvent, formatDuration, jpegDataUrl } from './eventsView';

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
      'http://127.0.0.1:47821/api/v1/exams/e%201/events?source=agent&studentId=s1&after=7&limit=50',
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
