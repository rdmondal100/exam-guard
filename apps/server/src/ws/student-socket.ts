import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import {
  HELLO_TIMEOUT_MS,
  STUDENT_IDLE_MS,
  StudentMessageSchema,
  WS_CLOSE,
  isAgentEventType,
  isProtocolCompatible,
  type ServerToStudent,
  type SessionState,
} from '@examguard/shared';
import { takeAnswerSave, type AnswerIntakeDeps } from '../answers/answer-intake.js';
import type { EventRepo } from '../db/event-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import type { TerminalLogRepo } from '../db/terminal-log-repo.js';
import { hashToken } from '../join/join-service.js';
import type { EvidenceIntake } from '../screenshots/evidence-intake.js';
import type { SubmissionService } from '../submissions/submission-service.js';
import type { SessionHub, StudentConn } from './session-hub.js';

export interface StudentSocketDeps {
  hub: SessionHub;
  students: ExamStudentRepo;
  events: EventRepo;
  terminalLogs: TerminalLogRepo;
  /** Autosaves go through the batch writer. */
  answers: AnswerIntakeDeps;
  /** Makes a student's answers final (M18). */
  submissions: Pick<SubmissionService, 'submit'>;
  /** What the agent saw: screenshot chunks (binary frames) and the events that name them (M22). */
  evidence: Pick<EvidenceIntake, 'chunk' | 'report' | 'forget'>;
  /** The state the client should show; also activates a late joiner. */
  sessionState: (studentId: string) => SessionState;
  /** The hosted exam id, or `null` when nothing is hosted. */
  examId: () => string | null;
  now?: () => number;
  helloTimeoutMs?: number;
  idleMs?: number;
}

const bytes = (data: RawData): Buffer =>
  Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);

const text = (data: RawData): string => bytes(data).toString('utf8');

/** `GET /ws` on the student listener: hello → welcome, then ping/pong and the connected flag. */
export function registerStudentSocket(app: FastifyInstance, deps: StudentSocketDeps): void {
  const now = deps.now ?? Date.now;
  const helloTimeoutMs = deps.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const idleMs = deps.idleMs ?? STUDENT_IDLE_MS;

  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    const send = (message: ServerToStudent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const refuse = (code: number, errorCode: string, message: string) => {
      send({ t: 'error', code: errorCode, message });
      socket.close(code, errorCode);
    };

    let studentId: string | null = null;
    let examId: string | null = null;
    let lastFrame = now();
    const conn: StudentConn = {
      send,
      close: (code, reason) => socket.close(code, reason),
    };

    const helloTimer = setTimeout(() => {
      if (!studentId) refuse(WS_CLOSE.badHello, 'hello_timeout', 'Send hello first');
    }, helloTimeoutMs);
    // Checked often enough that a dead socket is dropped soon after the idle limit.
    const sweep = setInterval(
      () => {
        if (studentId && now() - lastFrame > idleMs) socket.terminate();
      },
      Math.max(50, Math.min(1000, Math.floor(idleMs / 3))),
    );

    socket.on('message', (data: RawData, isBinary: boolean) => {
      lastFrame = now();
      if (isBinary) {
        // The only binary frames are screenshot chunks, and only from a signed-in student.
        if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
        return deps.evidence.chunk(studentId, bytes(data));
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text(data));
      } catch {
        return refuse(WS_CLOSE.badHello, 'bad_frame', 'Frames must be JSON');
      }
      const parsed = StudentMessageSchema.safeParse(raw);
      if (!parsed.success) return refuse(WS_CLOSE.badHello, 'bad_frame', 'Unknown message');
      const message = parsed.data;

      if (message.t === 'ping') {
        if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
        return send({ t: 'pong', clientSent: message.clientSent, serverTime: now() });
      }
      if (message.t === 'event') {
        if (!studentId || !examId)
          return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
        if (isAgentEventType(message.type)) {
          deps.evidence.report(examId, studentId, message);
          return send({ t: 'event.ack', id: message.id });
        }
        // App events are low until the classifier (M31) grades them. The key is namespaced so
        // an app id can never collide with agent evidence keys.
        deps.events.insert({
          examId,
          examStudentId: studentId,
          type: message.type,
          severity: 'low',
          source: 'app',
          details: message.details,
          serverTs: now(),
          clientTs: message.clientTs,
          dedupeKey: `app:${message.dedupeKey}`,
        });
        return send({ t: 'event.ack', id: message.id });
      }
      if (message.t === 'agent.status') {
        if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
        return deps.hub.setAgent(studentId, message);
      }
      if (message.t === 'internet.status') {
        if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
        return deps.hub.setInternet(studentId, message.blocked);
      }
      if (message.t === 'transcript') {
        if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
        // Acked even when dropped over the cap, so the client stops re-sending it.
        deps.terminalLogs.append({
          examStudentId: studentId,
          key: message.key,
          text: message.text,
          serverTs: now(),
          clientTs: message.clientTs,
        });
        return send({ t: 'transcript.ack', key: message.key });
      }
      if (message.t === 'answer.save') {
        if (!studentId || !examId)
          return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
        const { id, clientSeq } = message;
        return takeAnswerSave(deps.answers, examId, studentId, message, () =>
          send({ t: 'answer.ack', id, clientSeq }),
        );
      }
      if (message.t === 'submit') {
        if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
        // Saves sent before this frame are already in the batch; `submit` flushes it.
        const outcome = deps.submissions.submit(studentId);
        return send(
          outcome.ok
            ? { t: 'submit.result', id: message.id, receipt: outcome.receipt }
            : { t: 'submit.refused', id: message.id, reason: outcome.reason },
        );
      }
      if (studentId) return refuse(WS_CLOSE.badHello, 'bad_frame', 'Already said hello');

      if (!isProtocolCompatible(message.protocol)) {
        return refuse(
          WS_CLOSE.protocolMismatch,
          'protocol_mismatch',
          "Update ExamGuard to match the teacher's version",
        );
      }
      const hostedId = deps.examId();
      if (!hostedId) return refuse(WS_CLOSE.notHosting, 'not_hosting', 'No exam is being hosted');
      const student = deps.students.findByTokenHash(hashToken(message.token));
      if (!student || student.examId !== hostedId) {
        return refuse(WS_CLOSE.unauthorized, 'unauthorized', 'Sign in again');
      }
      studentId = student.id;
      examId = hostedId;
      clearTimeout(helloTimer);
      deps.hub.attach(student.id, conn, WS_CLOSE.replaced);
      send({ t: 'welcome', serverTime: now(), state: deps.sessionState(student.id) });
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(sweep);
      if (studentId) {
        deps.evidence.forget(studentId);
        deps.hub.detach(studentId, conn);
      }
    });
    socket.on('error', () => socket.terminate());
  });
}
