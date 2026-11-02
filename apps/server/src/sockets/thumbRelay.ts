import {
  FAST_THUMB_INTERVAL_MS,
  FAST_THUMB_WIDTH,
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

/** How a student streams: the grid picture, or the larger one every second for an open detail (M34). */
type Mode = 'grid' | 'fast';

interface Watching {
  page: ReadonlySet<string>;
  focus: ReadonlySet<string>;
}

/**
 * Thumbnail fan-out (M29, M33; docs/architecture.md §5). Only the students some teacher socket
 * has on its visible page are told to stream (`thumb.start`); the rest get `thumb.stop`. The
 * latest frame per student is kept in memory only, forwarded to the viewers watching that student,
 * and sent at once to a viewer that switches to a page, so a page switch shows pictures straight
 * away. A student in some viewer's focus (the fast thumbnail, M34 fallback) streams a larger
 * picture every second instead; the grid tile shows the same frames.
 */
export class ThumbRelay {
  private readonly viewers = new Map<ThumbViewer, Watching>();
  /** Students told to stream, who still have a socket, and how. */
  private readonly streaming = new Map<string, Mode>();
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
    this.update(viewer, { page: new Set(ids) });
  }

  /** The students whose fast thumbnail the viewer shows (M34 fallback); `[]` ends it. */
  focus(viewer: ThumbViewer, ids: readonly string[]): void {
    this.update(viewer, { focus: new Set(ids) });
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
    const mode = this.wanted().get(id);
    if (mode) this.start(id, mode);
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
    for (const [viewer, w] of this.viewers) {
      if (w.page.has(studentId) || w.focus.has(studentId)) this.send(viewer, out);
    }
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

  private update(viewer: ThumbViewer, change: Partial<Watching>): void {
    const before = this.viewers.get(viewer) ?? {
      page: new Set<string>(),
      focus: new Set<string>(),
    };
    const next = { ...before, ...change };
    if (next.page.size === 0 && next.focus.size === 0) this.viewers.delete(viewer);
    else this.viewers.set(viewer, next);
    this.reconcile();
    // Newly watched students show their latest picture at once.
    for (const id of new Set([...next.page, ...next.focus])) {
      if (before.page.has(id) || before.focus.has(id)) continue;
      const frame = this.latest.get(id);
      if (frame) this.send(viewer, frame);
    }
  }

  /** Every watched student and how: a focus anywhere wins over a grid page. */
  private wanted(): Map<string, Mode> {
    const all = new Map<string, Mode>();
    for (const w of this.viewers.values()) {
      for (const id of w.page) if (!all.has(id)) all.set(id, 'grid');
      for (const id of w.focus) all.set(id, 'fast');
    }
    return all;
  }

  private reconcile(): void {
    const wanted = this.wanted();
    for (const id of [...this.streaming.keys()]) {
      if (wanted.has(id)) continue;
      this.streaming.delete(id);
      this.deps.students.sendTo(id, { t: 'thumb.stop' });
    }
    for (const [id, mode] of wanted) {
      if (this.streaming.get(id) !== mode && this.deps.students.isConnected(id)) {
        this.start(id, mode);
      }
    }
  }

  private start(id: string, mode: Mode): void {
    this.streaming.set(id, mode);
    this.deps.students.sendTo(
      id,
      mode === 'fast'
        ? { t: 'thumb.start', intervalMs: FAST_THUMB_INTERVAL_MS, width: FAST_THUMB_WIDTH }
        : {
            t: 'thumb.start',
            intervalMs: this.deps.intervalMs ?? THUMB_INTERVAL_MS,
            width: this.deps.width ?? THUMB_WIDTH,
          },
    );
  }

  private send(viewer: ThumbViewer, frame: Uint8Array): void {
    this.counters.framesOut += 1;
    this.counters.bytesOut += frame.length;
    viewer.sendBinary(frame);
  }
}
