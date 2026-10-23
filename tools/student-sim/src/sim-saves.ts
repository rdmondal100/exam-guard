import type WebSocket from 'ws';
import type { FinalAnswerInput } from '@examguard/shared';

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

type Reason = 'interval' | 'run' | 'switch_question' | 'switch_language';

interface Save {
  t: 'answer.save';
  id: string;
  clientSeq: number;
  clientTs: number;
  questionId: string;
  language: string;
  content: string;
  selected: true;
  reason: Reason;
}

/** Largest buffer a fake student grows to (characters); real answers are a few KB. */
const MAX_CONTENT = 4_000;

const languagesOf = (q: QuestionInfo): string[] =>
  q.type === 'code' && q.allowedLanguages.length > 0 ? q.allowedLanguages : ['text'];

/**
 * What one fake student writes once the exam runs: buffers in all questions that grow a little with
 * every tick, saved like the real app does (numbered, re-sent until acked). A tick picks a question
 * at random, now and then switches language or "runs" the code, so every save reason shows up.
 */
export class SimSaves {
  private questions: QuestionInfo[] = [];
  private nextSeq = 1;
  private readonly unacked = new Map<number, Save>();
  private readonly buffers = new Map<string, string>();
  /** The language each question was last saved in (the one that counts). */
  private readonly chosen = new Map<string, string>();
  private lastQuestion: string | null = null;
  private sent = 0;
  private acked = 0;
  private timer: NodeJS.Timeout | null = null;
  private frozen = false;

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
    if (this.questions.length > 0 || !Array.isArray(questions) || questions.length === 0) {
      return false;
    }
    this.questions = questions as QuestionInfo[];
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
    if (this.questions.length === 0) return;
    for (const save of this.unacked.values()) this.send(ws, save);
    if (this.frozen) return;
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

  /** No new saves from now on (the student is submitting); unacked ones are still re-sent. */
  freeze(): void {
    this.frozen = true;
    this.detach();
  }

  ack(clientSeq: number): void {
    if (this.unacked.delete(clientSeq)) this.acked += 1;
  }

  stats(): SaveStats {
    return { sent: this.sent, acked: this.acked, pending: this.unacked.size };
  }

  /** The answers the server should hold for this student after every save arrived. */
  expectedAnswers(): FinalAnswerInput[] {
    return this.questions.map((q) => {
      const language = this.chosen.get(q.id) ?? (languagesOf(q)[0] as string);
      return {
        questionId: q.id,
        language,
        content: this.buffers.get(`${q.id}\u0000${language}`) ?? '',
      };
    });
  }

  private tick(ws: WebSocket): void {
    const q = this.questions[Math.floor(Math.random() * this.questions.length)];
    if (!q) return;
    const languages = languagesOf(q);
    const before = this.chosen.get(q.id);
    let language = before ?? (languages[0] as string);
    let reason: Reason = 'interval';
    if (languages.length > 1 && Math.random() < 0.15) {
      language = languages[Math.floor(Math.random() * languages.length)] as string;
    }
    if (before !== undefined && language !== before) reason = 'switch_language';
    else if (this.lastQuestion !== null && this.lastQuestion !== q.id) reason = 'switch_question';
    else if (q.type === 'code' && Math.random() < 0.1) reason = 'run';
    this.lastQuestion = q.id;
    this.chosen.set(q.id, language);

    const key = `${q.id}\u0000${language}`;
    const content = `${this.buffers.get(key) ?? `// student ${this.code}\n`}x = x + 1;\n`.slice(
      0,
      MAX_CONTENT,
    );
    this.buffers.set(key, content);
    const save: Save = {
      t: 'answer.save',
      id: `sim-${this.code}-${this.nextSeq}`,
      clientSeq: this.nextSeq,
      clientTs: Date.now(),
      questionId: q.id,
      language,
      content,
      selected: true,
      reason,
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
