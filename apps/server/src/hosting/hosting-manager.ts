import type { FastifyInstance } from 'fastify';
import { STUDENT_API_PORT, type HostingInfo } from '@examguard/shared';
import type { ExamRepo } from '../db/exam-repo.js';
import type { QuestionRepo } from '../db/question-repo.js';
import { assertTransition } from '../exams/exam-state.js';
import { readyProblems } from '../exams/ready-check.js';
import { buildStudentApp } from '../http/student-app.js';
import { loadOrCreateCert } from '../tls/cert.js';
import { lanAddresses } from '../tls/lan-addresses.js';
import { advertiseOverMdns, type Advertise } from './mdns-advertiser.js';
import { generatePin } from './pin.js';

/** A refusal the routes turn into an HTTP error. */
export class HostingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HostingError';
  }
}

export interface HostingManagerDeps {
  exams: ExamRepo;
  questions: QuestionRepo;
  dataDir: string;
  /** Tests use 0 (any free port) and 127.0.0.1. */
  port?: number;
  host?: string;
  /** Called when the listener opens or closes; main blocks sleep while it is open. */
  onActive?: (active: boolean) => void;
  now?: () => number;
  addresses?: () => string[];
  makePin?: () => string;
  /** mDNS advertising; tests pass a fake. */
  advertise?: Advertise;
}

interface Active {
  examId: string;
  pin: string;
  fpCode: string;
  app: FastifyInstance;
  port: number;
  stopAdvertising: () => void;
}

/** Owns the student HTTPS listener: open only while an exam is `hosting`. */
export class HostingManager {
  private active: Active | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: HostingManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** ready → hosting. Re-checks readiness, since questions stay editable in `ready`. */
  async start(examId: string): Promise<HostingInfo> {
    const { exams, questions } = this.deps;
    const exam = exams.get(examId);
    if (!exam) throw new HostingError(404, 'not_found', 'Exam not found');
    if (this.active || exams.hostedExam()) {
      throw new HostingError(409, 'already_hosting', 'An exam is already being hosted');
    }
    if (exam.state !== 'ready') {
      throw new HostingError(409, 'invalid_state', `A ${exam.state} exam cannot be hosted`);
    }
    assertTransition(exam.state, 'hosting');
    const problems = readyProblems(exam, questions.list(exam.id));
    if (problems.length > 0) {
      throw new HostingError(422, 'not_ready', 'The exam is not ready yet', { problems });
    }
    const pin = (this.deps.makePin ?? generatePin)();
    const opened = await this.open(exam.id, pin);
    exams.startHosting(exam.id, pin, this.now());
    return this.describe(opened);
  }

  /** hosting → ready, and the listener closes. */
  async stop(examId: string): Promise<void> {
    const { exams } = this.deps;
    const exam = exams.get(examId);
    if (!exam) throw new HostingError(404, 'not_found', 'Exam not found');
    if (exam.state !== 'hosting') {
      throw new HostingError(409, 'invalid_state', `A ${exam.state} exam is not being hosted`);
    }
    assertTransition(exam.state, 'ready');
    await this.close();
    exams.stopHosting(exam.id, this.now());
  }

  info(examId: string): HostingInfo | null {
    return this.active?.examId === examId ? this.describe(this.active) : null;
  }

  /** After a server restart: reopen the listener for an exam still in `hosting`, same PIN. */
  async resume(): Promise<void> {
    const hosted = this.deps.exams.hostedExam();
    if (hosted && !this.active) await this.open(hosted.exam.id, hosted.pin);
  }

  async close(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.stopAdvertising();
    await active.app.close();
    this.deps.onActive?.(false);
  }

  private async open(examId: string, pin: string): Promise<Active> {
    const cert = await loadOrCreateCert(this.deps.dataDir);
    const app = buildStudentApp({
      cert,
      current: () => {
        const exam = this.deps.exams.get(examId);
        return exam ? { examTitle: exam.title, state: 'hosting' } : null;
      },
    });
    try {
      await app.listen({
        host: this.deps.host ?? '0.0.0.0',
        port: this.deps.port ?? STUDENT_API_PORT,
      });
    } catch (e) {
      await app.close();
      if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        throw new HostingError(409, 'port_in_use', 'The student port is already in use');
      }
      throw e;
    }
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : STUDENT_API_PORT;
    let stopAdvertising = () => {};
    try {
      const exam = this.deps.exams.get(examId);
      stopAdvertising = (this.deps.advertise ?? advertiseOverMdns)({
        title: exam?.title ?? '',
        port,
        fingerprint: cert.fingerprint,
      });
    } catch {
      // Discovery is best effort: students can still join by manual IP.
    }
    this.active = { examId, pin, fpCode: cert.fpCode, app, port, stopAdvertising };
    this.deps.onActive?.(true);
    return this.active;
  }

  private describe(active: Active): HostingInfo {
    const addresses = (this.deps.addresses ?? lanAddresses)();
    return { pin: active.pin, addresses, port: active.port, fpCode: active.fpCode };
  }
}
