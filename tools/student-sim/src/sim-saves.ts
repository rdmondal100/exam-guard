import type WebSocket from 'ws';

export interface SaveStats {
  sent: number;
  acked: number;
  /** Sent at least once and not acked yet. */
  pending: number;
}

interface QuestionInfo {
  id: string;
  type: string;
  allowedLanguages: string[];
}

interface Save {
  t: 'answer.save';
  id: string;
  clientSeq: number;
  clientTs: number;
  questionId: string;
  language: string;
  content: string;
  selected: true;
  reason: 'interval';
}

/** Largest buffer a fake student grows to (characters); real answers are a few KB. */
const MAX_CONTENT = 4_000;

/**
 * What one fake student writes once the exam runs: a buffer in the first question that grows a
 * little with every tick, saved like the real app does (numbered, re-sent until acked).
 */
export class SimSaves {
  private question: QuestionInfo | null = null;
  private nextSeq = 1;
  private edits = 0;
  private readonly unacked = new Map<number, Save>();
  private sent = 0;
  private acked = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly everyMs: number,
    private readonly code: string,
  ) {}

  /**
   * Questions arrive with the welcome of a running exam, or with the Start push. Returns true
   * when this call is the one that gave the student something to write.
   */
  setQuestions(questions: unknown, saved: unknown): boolean {
    this.continueAfter(saved);
    if (this.question || !Array.isArray(questions) || questions.length === 0) return false;
    this.question = questions[0] as QuestionInfo;
    return true;
  }

  private continueAfter(saved: unknown): void {
    if (!Array.isArray(saved)) return;
    for (const s of saved as { clientSeq?: number }[]) {
      this.nextSeq = Math.max(this.nextSeq, (s.clientSeq ?? 0) + 1);
    }
  }

  /** Called on every welcome: starts the timer and re-sends what was not acked. */
  attach(ws: WebSocket): void {
    this.detach();
    if (!this.question) return;
    for (const save of this.unacked.values()) this.send(ws, save);
    // Jittered so 200 students do not save in the same millisecond.
    const first = Math.random() * this.everyMs;
    this.timer = setTimeout(() => {
      this.tick(ws);
      this.timer = setInterval(() => this.tick(ws), this.everyMs);
    }, first);
  }

  detach(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
    }
    this.timer = null;
  }

  ack(clientSeq: number): void {
    if (this.unacked.delete(clientSeq)) this.acked += 1;
  }

  stats(): SaveStats {
    return { sent: this.sent, acked: this.acked, pending: this.unacked.size };
  }

  private tick(ws: WebSocket): void {
    const q = this.question;
    if (!q) return;
    this.edits += 1;
    const language = q.type === 'code' && q.allowedLanguages[0] ? q.allowedLanguages[0] : 'text';
    const save: Save = {
      t: 'answer.save',
      id: `sim-${this.code}-${this.nextSeq}`,
      clientSeq: this.nextSeq,
      clientTs: Date.now(),
      questionId: q.id,
      language,
      content: `// student ${this.code}\n${'x = x + 1;\n'.repeat(this.edits)}`.slice(
        0,
        MAX_CONTENT,
      ),
      selected: true,
      reason: 'interval',
    };
    this.nextSeq += 1;
    this.unacked.set(save.clientSeq, save);
    this.send(ws, save);
  }

  private send(ws: WebSocket, save: Save): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(save));
    this.sent += 1;
  }
}
