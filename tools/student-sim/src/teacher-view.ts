import WebSocket from 'ws';
import type { SimMetrics } from './metrics.js';

export interface TeacherViewOptions {
  /** Loopback teacher API port and its token. */
  port: number;
  token: string;
  examId: string;
  /** Students on the visible thumbnail page (the real grid shows about 30). */
  pageSize: number;
  /** Move to the next page this often. */
  pageMs: number;
  metrics: SimMetrics;
  /** Send time of every sim event by id (`details.simId`). */
  eventTimes: Map<string, number>;
}

interface AlertMessage {
  t: 'alert';
  event?: { details?: { simId?: unknown } };
}

/**
 * The teacher dashboard's socket during a load test (M47): it subscribes to the exam, shows one
 * page of thumbnails at a time and flips pages, and times each sim event from its send to its
 * `alert`.
 */
export class TeacherView {
  private ws: WebSocket | null = null;
  private readonly students = new Map<string, string>();
  private page = 0;
  private pageTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** Alerts whose event the sim did not make (a real student's). */
  otherAlerts = 0;

  constructor(private readonly options: TeacherViewOptions) {}

  start(): void {
    const { port, token, examId, metrics } = this.options;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    this.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'subscribe', examId })));
    ws.on('message', (data: Buffer, isBinary) => {
      metrics.teacherDown += data.length;
      if (isBinary) {
        metrics.teacherThumbs += 1;
        return;
      }
      const message = JSON.parse(data.toString()) as { t?: string };
      if (message.t === 'roster') return this.roster(message as { students?: unknown });
      if (message.t === 'alert') return this.alert(message as AlertMessage);
    });
    ws.on('close', () => {
      if (!this.stopped) setTimeout(() => this.start(), 1000);
    });
    ws.on('error', () => ws.terminate());
    this.pageTimer ??= setInterval(() => this.flip(), this.options.pageMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.pageTimer) clearInterval(this.pageTimer);
    this.pageTimer = null;
    this.ws?.terminate();
  }

  private roster(message: { students?: unknown }): void {
    if (!Array.isArray(message.students)) return;
    const before = this.students.size;
    for (const row of message.students as { id?: unknown; studentCode?: unknown }[]) {
      if (typeof row.id === 'string') this.students.set(row.id, String(row.studentCode));
    }
    if (this.students.size !== before) this.show();
  }

  private alert(message: AlertMessage): void {
    const id = message.event?.details?.simId;
    const sentAt = typeof id === 'string' ? this.options.eventTimes.get(id) : undefined;
    if (sentAt === undefined) {
      this.otherAlerts += 1;
      return;
    }
    this.options.metrics.alertLag.add(Date.now() - sentAt);
  }

  private flip(): void {
    const pages = Math.max(1, Math.ceil(this.students.size / this.options.pageSize));
    this.page = (this.page + 1) % pages;
    this.show();
  }

  /** Sends the ids on the current page, ordered by student code as the grid sorts them. */
  private show(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const ordered = [...this.students.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
      .map(([id]) => id);
    const { pageSize } = this.options;
    const ids = ordered.slice(this.page * pageSize, (this.page + 1) * pageSize);
    ws.send(JSON.stringify({ t: 'thumbs.subscribe', examStudentIds: ids }));
  }
}
