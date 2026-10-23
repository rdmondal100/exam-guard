import type { FastifyInstance } from 'fastify';
import {
  STUDENT_API_PORT,
  WS_CLOSE,
  toStudentQuestion,
  type HostingInfo,
  type SessionState,
  type StartResult,
} from '@examguard/shared';
import { computeDeadline } from '../exams/deadline.js';
import type { EventRepo } from '../db/event-repo.js';
import type { ExamFileService } from '../exam-files/exam-file-service.js';
import type { ExamRepo } from '../db/exam-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import type { QuestionRepo } from '../db/question-repo.js';
import type { TeacherActionRepo } from '../db/teacher-action-repo.js';
import type { TerminalLogRepo } from '../db/terminal-log-repo.js';
import type { TerminalRepo } from '../db/terminal-repo.js';
import { JoinService } from '../join/join-service.js';
import { assertTransition } from '../exams/exam-state.js';
import { readyProblems } from '../exams/ready-check.js';
import { buildStudentApp } from '../http/student-app.js';
import { loadOrCreateCert } from '../tls/cert.js';
import { lanAddresses } from '../tls/lan-addresses.js';
import { advertiseOverMdns, type Advertise } from './mdns-advertiser.js';
import type { SessionHub } from '../ws/session-hub.js';
import { generatePin } from './pin.js';
import { HostingError } from './hosting-error.js';
import { TerminalSwitch } from './terminal-switch.js';

export { HostingError };

export interface HostingManagerDeps {
  exams: ExamRepo;
  questions: QuestionRepo;
  students: ExamStudentRepo;
  events: EventRepo;
  terminals: TerminalRepo;
  terminalLogs: TerminalLogRepo;
  actions: TeacherActionRepo;
  /** The teacher's exam files: the manifest in the session state and the download route. */
  examFiles: ExamFileService;
  /** Live student sockets and teacher subscribers. */
  hub: SessionHub;
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
  /** Student socket timings; tests shorten them. */
  socketTimings?: { helloTimeoutMs?: number; idleMs?: number };
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
  private deadlineTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  /** The teacher's exam terminal switch. */
  readonly terminal: TerminalSwitch;

  constructor(private readonly deps: HostingManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.terminal = new TerminalSwitch({
      terminals: deps.terminals,
      actions: deps.actions,
      hub: deps.hub,
      examState: (id) => deps.exams.get(id)?.state,
      now: this.now,
    });
  }

  /** ready → hosting. Re-checks readiness, since questions stay editable in `ready`. */
  async start(examId: string): Promise<HostingInfo> {
    const { exams, questions } = this.deps;
    const exam = exams.get(examId);
    if (!exam) throw new HostingError(404, 'not_found', 'Exam not found');
    if (this.active || exams.hostedExam() || exams.runningExam()) {
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

  /** hosting → running. Everyone in the lobby becomes active and gets the questions and deadline. */
  startExam(examId: string): StartResult {
    const { exams, students, hub } = this.deps;
    const exam = exams.get(examId);
    if (!exam) throw new HostingError(404, 'not_found', 'Exam not found');
    if (exam.state !== 'hosting' || this.active?.examId !== examId) {
      throw new HostingError(409, 'invalid_state', `A ${exam.state} exam cannot be started`);
    }
    assertTransition(exam.state, 'running');
    const startedAt = this.now();
    exams.startRunning(examId, startedAt);
    this.terminal.examStarted(examId, startedAt);
    for (const id of students.activateAllInLobby(examId, startedAt)) hub.changed(id);
    hub.broadcast((id) => ({ t: 'state', state: this.sessionState(id) }));
    const deadline = this.deadlineFor(examId, null);
    if (deadline === null) throw new Error('Running exam has no start time');
    this.watchDeadline(examId);
    return { ok: true, startedAt, deadline };
  }

  /**
   * running → ended, by the teacher (`manual`) or because the last deadline passed. Students get
   * the `ended` state, then the listener closes. A manual end also marks working students.
   */
  async endExam(examId: string, reason: 'manual' | 'time_up' = 'manual'): Promise<void> {
    const { exams, students, hub } = this.deps;
    const exam = exams.get(examId);
    if (!exam) throw new HostingError(404, 'not_found', 'Exam not found');
    if (exam.state !== 'running') {
      throw new HostingError(409, 'invalid_state', `A ${exam.state} exam cannot be ended`);
    }
    assertTransition(exam.state, 'ended');
    this.stopWatchingDeadline();
    exams.endRunning(examId, this.now());
    if (reason === 'manual') for (const id of students.endAllWorking(examId)) hub.changed(id);
    hub.broadcast((id) => ({ t: 'state', state: this.sessionState(id) }));
    await this.close();
  }

  /**
   * What a student's client should show right now. A student still in the lobby of a running
   * exam (a late joiner) becomes active here.
   */
  sessionState(studentId: string): SessionState {
    const { exams, students, questions, hub } = this.deps;
    const student = students.findById(studentId);
    if (!student) throw new Error(`Student ${studentId} not found`);
    const exam = exams.get(student.examId);
    const running = exam?.state === 'running';
    let state = student.state;
    if (running && state === 'lobby' && students.activate(studentId, this.now())) {
      state = 'active';
      hub.changed(studentId);
    }
    return {
      examState: exam?.state ?? 'hosting',
      studentState: state,
      deadline: running ? this.deadlineFor(student.examId, studentId) : null,
      questions: running ? questions.list(student.examId).map(toStudentQuestion) : undefined,
      saved: [],
      locked: state === 'locked',
      monitoring: false,
      terminal: this.terminal.state(student.examId),
      filesEnabled: exam?.filesEnabled ?? true,
      examFiles: exam?.filesEnabled ? this.deps.examFiles.list(student.examId) : [],
    };
  }

  info(examId: string): HostingInfo | null {
    return this.active?.examId === examId ? this.describe(this.active) : null;
  }

  /** After a server restart: reopen the listener for an exam still `hosting` or `running`, same PIN. */
  async resume(): Promise<void> {
    const { exams } = this.deps;
    const hosted = exams.hostedExam() ?? exams.runningExam();
    if (hosted && !this.active) await this.open(hosted.exam.id, hosted.pin);
    if (hosted?.exam.state === 'running') {
      this.watchDeadline(hosted.exam.id);
      this.terminal.arm(hosted.exam.id);
    }
  }

  /** Ends the exam once the latest deadline (extensions included) has passed. */
  private watchDeadline(examId: string): void {
    this.stopWatchingDeadline();
    const check = () => {
      const timing = this.deps.exams.timing(examId);
      if (!timing || timing.startedAt === null) return;
      this.terminal.check(examId);
      const last = computeDeadline({
        startedAt: timing.startedAt,
        durationSec: timing.durationSec,
        globalExtensionSec: timing.globalExtensionSec,
        studentExtensionSec: this.deps.students.maxExtensionSec(examId),
      });
      if (this.now() < last) return;
      this.endExam(examId, 'time_up').catch(() => this.stopWatchingDeadline());
    };
    this.deadlineTimer = setInterval(check, 1000);
    this.deadlineTimer.unref();
    check();
  }

  private stopWatchingDeadline(): void {
    if (this.deadlineTimer) clearInterval(this.deadlineTimer);
    this.deadlineTimer = null;
  }

  private deadlineFor(examId: string, studentId: string | null): number | null {
    const timing = this.deps.exams.timing(examId);
    if (!timing || timing.startedAt === null) return null;
    return computeDeadline({
      startedAt: timing.startedAt,
      durationSec: timing.durationSec,
      globalExtensionSec: timing.globalExtensionSec,
      studentExtensionSec: studentId ? this.deps.students.extensionSec(studentId) : 0,
    });
  }

  async close(): Promise<void> {
    const active = this.active;
    this.stopWatchingDeadline();
    this.terminal.disarm();
    if (!active) return;
    this.active = null;
    active.stopAdvertising();
    this.deps.hub.closeAll(WS_CLOSE.notHosting, 'not_hosting');
    await active.app.close();
    this.deps.students.resetConnections();
    this.deps.onActive?.(false);
  }

  private async open(examId: string, pin: string): Promise<Active> {
    const cert = await loadOrCreateCert(this.deps.dataDir);
    // No socket survives a restart, so any leftover flag is stale.
    this.deps.students.resetConnections();
    const join = new JoinService({
      exams: this.deps.exams,
      students: this.deps.students,
      events: this.deps.events,
      now: this.now,
      onChange: (id) => this.deps.hub.changed(id),
      target: () => ({ examId, pin, fingerprint: cert.fingerprint }),
    });
    const app = buildStudentApp({
      cert,
      join,
      files: { exams: this.deps.exams, students: this.deps.students, files: this.deps.examFiles },
      current: () => {
        const exam = this.deps.exams.get(examId);
        if (!exam) return null;
        return { examTitle: exam.title, state: exam.state === 'running' ? 'running' : 'hosting' };
      },
      live: {
        hub: this.deps.hub,
        students: this.deps.students,
        events: this.deps.events,
        terminalLogs: this.deps.terminalLogs,
        sessionState: (id) => this.sessionState(id),
        examId: () => (this.active?.examId === examId ? examId : null),
        now: this.now,
        ...this.deps.socketTimings,
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
    return {
      pin: active.pin,
      addresses,
      port: active.port,
      fpCode: active.fpCode,
      terminal: this.terminal.state(active.examId),
      terminalPendingMinutes: this.terminal.pendingMinutes(active.examId),
    };
  }
}
