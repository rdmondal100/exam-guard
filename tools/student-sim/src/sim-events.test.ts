import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { decodeScreenshotFrame } from '@examguard/shared';
import { Latency, SimMetrics } from './metrics.js';
import { SIM_SCREENSHOT_BYTES, SimEvents } from './sim-events.js';
import { syntheticJpeg } from './sim-thumbs.js';

interface Sent {
  json: { t: string; id: string; type: string; screenshotRef?: string; details: object }[];
  binary: Uint8Array[];
}

function fakeSocket(): { ws: WebSocket; sent: Sent } {
  const sent: Sent = { json: [], binary: [] };
  const ws = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (data: string | Uint8Array) => {
      if (typeof data === 'string') sent.json.push(JSON.parse(data) as Sent['json'][number]);
      else sent.binary.push(data);
    },
  } as unknown as WebSocket;
  return { ws, sent };
}

describe('Latency', () => {
  it('gives nearest-rank percentiles and the maximum', () => {
    const latency = new Latency();
    expect(latency.percentile(95)).toBe(0);
    for (let ms = 1; ms <= 100; ms += 1) latency.add(ms);
    expect(latency.percentile(50)).toBe(50);
    expect(latency.percentile(95)).toBe(95);
    expect(latency.max()).toBe(100);
    expect(latency.count).toBe(100);
  });
});

describe('syntheticJpeg', () => {
  it('reaches screenshot size with several comment segments and still ends like a JPEG', () => {
    const jpeg = syntheticJpeg(SIM_SCREENSHOT_BYTES, 1);
    expect(Math.abs(jpeg.length - SIM_SCREENSHOT_BYTES)).toBeLessThanOrEqual(4);
    expect([jpeg[0], jpeg[1], jpeg[2], jpeg[3]]).toEqual([0xff, 0xd8, 0xff, 0xfe]);
    expect([jpeg.at(-2), jpeg.at(-1)]).toEqual([0xff, 0xd9]);
  });
});

describe('SimEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // First trip at 30 s, 13.5 s outside (no still_outside), the next one at 103.5 s.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('leaves with a screenshot, comes back, and re-sends unacked events after a reconnect', () => {
    const metrics = new SimMetrics();
    const times = new Map<string, number>();
    const events = new SimEvents(60_000, '7', metrics, times);
    const first = fakeSocket();
    events.attach(first.ws);
    vi.advanceTimersByTime(85_000);
    expect(first.sent.json.map((m) => m.type)).toEqual(['focus_lost', 'focus_returned']);
    expect(first.sent.binary).toHaveLength(1);

    const lost = first.sent.json.find((m) => m.type === 'focus_lost');
    expect(lost?.screenshotRef).toBeDefined();
    const chunk = decodeScreenshotFrame(first.sent.binary[0] ?? new Uint8Array());
    expect(chunk?.header.ref).toBe(lost?.screenshotRef);
    expect(lost?.details).toMatchObject({ simId: lost?.id });
    expect(times.has(lost?.id ?? '')).toBe(true);

    for (const m of first.sent.json.filter((e) => e.type !== 'focus_lost')) events.ack(m.id);
    expect(events.totals()).toMatchObject({ pending: 1 });
    expect(metrics.eventLag.count).toBe(1);

    events.detach();
    const second = fakeSocket();
    events.attach(second.ws);
    expect(second.sent.json[0]?.id).toBe(lost?.id);
    expect(second.sent.binary).toHaveLength(1);
    expect(events.ack(lost?.id ?? '')).toBe(true);
    expect(events.ack(lost?.id ?? '')).toBe(false);
    expect(events.totals().pending).toBe(0);
  });

  it('makes no new events once frozen', () => {
    const events = new SimEvents(1000, '1', new SimMetrics(), new Map());
    const { ws, sent } = fakeSocket();
    events.freeze();
    events.attach(ws);
    vi.advanceTimersByTime(60_000);
    expect(sent.json).toHaveLength(0);
  });
});
