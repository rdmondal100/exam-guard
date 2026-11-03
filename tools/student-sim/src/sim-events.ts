import type WebSocket from 'ws';
import { encodeScreenshotFrames } from '@examguard/shared';
import type { SimMetrics } from './metrics.js';
import { syntheticJpeg } from './sim-thumbs.js';

/** About what a real full-screen screenshot weighs (JPEG, 1080p desktop). */
export const SIM_SCREENSHOT_BYTES = 150 * 1024;

export interface EventStats {
  /** Distinct events made. */
  made: number;
  acked: number;
  pending: number;
  withScreenshot: number;
}

interface Pending {
  id: string;
  sentAt: number;
  frames: Uint8Array[];
  json: string;
}

/**
 * What a fake agent reports while the exam runs (M47): every so often the student leaves the exam
 * (`focus_lost` with a screenshot), sometimes stays out long enough for a `still_outside` shot,
 * then comes back (`focus_returned` with the time outside). Unacked events, screenshots included,
 * are re-sent after every welcome, as the real agent replays its evidence; the server keeps each
 * dedupe key once.
 */
export class SimEvents {
  private seq = 0;
  private readonly unacked = new Map<string, Pending>();
  private timers: NodeJS.Timeout[] = [];
  private ws: WebSocket | null = null;
  private stats = { made: 0, acked: 0, withScreenshot: 0 };
  private readonly jpeg: Uint8Array;
  private frozen = false;

  constructor(
    private readonly everyMs: number,
    private readonly code: string,
    private readonly metrics: SimMetrics,
    /** Event ids this run made, so the teacher view can match alerts (`details.simId`). */
    private readonly sentAt: Map<string, number>,
  ) {
    this.jpeg = syntheticJpeg(SIM_SCREENSHOT_BYTES, code.length);
  }

  attach(ws: WebSocket): void {
    this.detach();
    this.ws = ws;
    for (const pending of this.unacked.values()) this.transmit(pending);
    if (!this.frozen) this.schedule(Math.random() * this.everyMs);
  }

  detach(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.ws = null;
  }

  /** No new events (the student submitted); unacked ones are still re-sent. */
  freeze(): void {
    this.frozen = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  ack(id: string): boolean {
    const pending = this.unacked.get(id);
    if (!pending) return false;
    this.unacked.delete(id);
    this.stats.acked += 1;
    this.metrics.eventLag.add(Date.now() - pending.sentAt);
    return true;
  }

  totals(): EventStats {
    return { ...this.stats, pending: this.unacked.size };
  }

  private schedule(delay: number): void {
    this.timers.push(setTimeout(() => this.leave(), delay));
  }

  /** One trip outside: lost now, maybe a periodic shot, back after 2–25 s. */
  private leave(): void {
    if (this.frozen) return;
    const leftAt = Date.now();
    this.report('focus_lost', { exe: 'notepad.exe', title: 'Untitled - Notepad' }, true);
    const away = 2000 + Math.random() * 23_000;
    if (away > 15_000) {
      this.timers.push(
        setTimeout(() => this.report('still_outside', { exe: 'notepad.exe' }, true), 12_000),
      );
    }
    this.timers.push(
      setTimeout(() => {
        this.report('focus_returned', { durationMs: Date.now() - leftAt }, false);
        this.schedule(this.everyMs * (0.5 + Math.random()));
      }, away),
    );
  }

  private report(type: string, details: Record<string, unknown>, shot: boolean): void {
    this.seq += 1;
    const id = `sim-ev-${this.code}-${this.seq}`;
    const ref = shot ? `shot-${this.code}-${this.seq}` : undefined;
    const sentAt = Date.now();
    const json = JSON.stringify({
      t: 'event',
      id,
      dedupeKey: `sim:${this.code}:${this.seq}`,
      clientTs: sentAt,
      type,
      details: { ...details, simId: id },
      ...(ref ? { screenshotRef: ref } : {}),
    });
    const pending = { id, sentAt, json, frames: ref ? encodeScreenshotFrames(ref, this.jpeg) : [] };
    this.stats.made += 1;
    if (ref) this.stats.withScreenshot += 1;
    this.unacked.set(id, pending);
    this.sentAt.set(id, sentAt);
    this.transmit(pending);
  }

  private transmit(pending: Pending): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) return;
    for (const frame of pending.frames) {
      ws.send(frame, { binary: true });
      this.metrics.up += frame.length;
    }
    ws.send(pending.json);
    this.metrics.up += pending.json.length;
  }
}
