import {
  StudentThumbHeaderSchema,
  THUMB_INTERVAL_MS,
  THUMB_WIDTH,
  decodeThumbFrame,
  encodeThumbFrame,
  type ServerToStudent,
  type ThumbStats,
} from '@examguard/shared';
import { looksLikeJpeg } from '../services/screenshots/chunk-assembler.js';

/** A teacher socket that may watch a grid page. */
export interface ThumbViewer {
  sendBinary(frame: Uint8Array): void;
}

/** What the relay needs from the session hub. */
export interface ThumbStudents {
  isConnected(id: string): boolean;
  sendTo(id: string, message: ServerToStudent): void;
}

export interface ThumbRelayDeps {
  students: ThumbStudents;
  now?: () => number;
  intervalMs?: number;
  width?: number;
}

/**
 * Thumbnail fan-out (M29, M33; docs/architecture.md §5). Only the students some teacher socket
 * has on its visible page are told to stream (`thumb.start`); the rest get `thumb.stop`. The
 * latest frame per student is kept in memory only, forwarded to the viewers watching that student,
 * and sent at once to a viewer that switches to a page, so a page switch shows pictures straight
 * away.
 */
export class ThumbRelay {
  private readonly viewers = new Map<ThumbViewer, ReadonlySet<string>>();
  /** Students told to stream, who still have a socket. */
  private readonly streaming = new Set<string>();
  /** The newest frame per student, already encoded for the teacher. */
  private readonly latest = new Map<string, Uint8Array>();
  private readonly now: () => number;
  private counters = { framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0, dropped: 0 };
  private since: number;

  constructor(private readonly deps: ThumbRelayDeps) {
    this.now = deps.now ?? Date.now;
    this.since = this.now();
  }

  /** The viewer's visible page; replaces what it watched before. `[]` watches nothing. */
  watch(viewer: ThumbViewer, ids: readonly string[]): void {
    const set = new Set(ids);
    if (set.size === 0) this.viewers.delete(viewer);
    else this.viewers.set(viewer, set);
    this.reconcile();
    for (const id of set) {
      const frame = this.latest.get(id);
      if (frame) this.send(viewer, frame);
    }
  }

  /** The teacher socket closed. */
  unwatch(viewer: ThumbViewer): void {
    if (this.viewers.delete(viewer)) this.reconcile();
  }

  /**
   * A student's socket got its `welcome`: a watched student is asked (again), since a new socket
   * has forgotten any earlier start.
   */
  onWelcome(id: string): void {
    this.streaming.delete(id);
    if (this.wanted().has(id)) this.start(id);
  }

  /** A student's last socket closed (the hub ignores a replaced one). */
  onDisconnect(id: string): void {
    this.streaming.delete(id);
  }

  /** A binary kind-1 frame from a signed-in student. */
  frame(studentId: string, bytes: Uint8Array): void {
    const decoded = decodeThumbFrame(bytes, StudentThumbHeaderSchema);
    if (!decoded || !looksLikeJpeg(decoded.jpeg) || !this.streaming.has(studentId)) {
      this.counters.dropped += 1;
      return;
    }
    this.counters.framesIn += 1;
    this.counters.bytesIn += bytes.length;
    const out = encodeThumbFrame({ examStudentId: studentId, ts: this.now() }, decoded.jpeg);
    this.latest.set(studentId, out);
    for (const [viewer, ids] of this.viewers) if (ids.has(studentId)) this.send(viewer, out);
  }

  stats(): ThumbStats {
    return {
      streaming: this.streaming.size,
      viewers: this.viewers.size,
      cached: this.latest.size,
      ...this.counters,
      since: this.since,
    };
  }

  /** Hosting stopped: every student socket is gone and no picture is kept. */
  reset(): void {
    this.streaming.clear();
    this.latest.clear();
    this.counters = { framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0, dropped: 0 };
    this.since = this.now();
  }

  private wanted(): Set<string> {
    const all = new Set<string>();
    for (const ids of this.viewers.values()) for (const id of ids) all.add(id);
    return all;
  }

  private reconcile(): void {
    const wanted = this.wanted();
    for (const id of [...this.streaming]) {
      if (wanted.has(id)) continue;
      this.streaming.delete(id);
      this.deps.students.sendTo(id, { t: 'thumb.stop' });
    }
    for (const id of wanted) {
      if (!this.streaming.has(id) && this.deps.students.isConnected(id)) this.start(id);
    }
  }

  private start(id: string): void {
    this.streaming.add(id);
    this.deps.students.sendTo(id, {
      t: 'thumb.start',
      intervalMs: this.deps.intervalMs ?? THUMB_INTERVAL_MS,
      width: this.deps.width ?? THUMB_WIDTH,
    });
  }

  private send(viewer: ThumbViewer, frame: Uint8Array): void {
    this.counters.framesOut += 1;
    this.counters.bytesOut += frame.length;
    viewer.sendBinary(frame);
  }
}
