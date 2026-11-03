import type { RawData, WebSocket } from 'ws';
import {
  BINARY_KIND_THUMB,
  HELLO_TIMEOUT_MS,
  STUDENT_IDLE_MS,
  StudentMessageSchema,
  WS_CLOSE,
  isAgentEventType,
  isProtocolCompatible,
  type ServerToStudent,
  type SessionState,
} from '@examguard/shared';
import { takeAnswerSave, type AnswerIntakeDeps } from '../services/answers/answer-intake.js';
import type { ExamStudentRepo } from '../db/repositories/examStudent.repo.js';
import type { TerminalLogRepo } from '../db/repositories/terminalLog.repo.js';
import { hashToken } from '../services/join/join-service.js';
import type { EvidenceIntake } from '../services/screenshots/evidence-intake.js';
import type { EventRecorder } from '../services/events/event-recorder.js';
import type { TeacherMessages } from '../services/hosting/teacher-messages.js';
import type { SubmissionService } from '../services/submissions/submission-service.js';
import type { SessionHub, StudentConn } from './sessionHub.js';
import type { ThumbRelay } from './thumbRelay.js';
import type { LiveRelay } from './liveRelay.js';

export interface StudentSocketDeps {
  hub: SessionHub;
  students: ExamStudentRepo;
  /** Classifies and stores the app's events (M31). */
  recorder: Pick<EventRecorder, 'record'>;
  terminalLogs: TerminalLogRepo;
  /** Autosaves go through the batch writer. */
  answers: AnswerIntakeDeps;
  /** Makes a student's answers final (M18). */
  submissions: Pick<SubmissionService, 'submit'>;
  /** What the agent saw: screenshot chunks (binary frames) and the events that name them (M22). */
  evidence: Pick<EvidenceIntake, 'chunk' | 'report' | 'forget'>;
  /** Grid thumbnails (binary kind 1) and who is asked to stream them (M29, M33). */
  thumbs?: Pick<ThumbRelay, 'frame' | 'onWelcome'>;
  /** WebRTC live view signaling (M30, M34). */
  liveViews?: Pick<LiveRelay, 'fromStudent' | 'studentState' | 'onStudentGone'>;
  /** Teacher messages: re-sent after each welcome until the app acks them (M35). */
  messages?: Pick<TeacherMessages, 'onWelcome' | 'ack'>;
  /** The student's app lost its agent link (`agent_lost`, M24): lock them. */
  onAgentLost?: (studentId: string) => void;
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

/** One `/ws` socket on the student listener: hello → welcome, then ping/pong and the connected flag. */
export function onStudentSocket(socket: WebSocket, deps: StudentSocketDeps): void {
  const now = deps.now ?? Date.now;
  const helloTimeoutMs = deps.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const idleMs = deps.idleMs ?? STUDENT_IDLE_MS;

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
      // Binary frames are thumbnails and screenshot chunks, and only from a signed-in student.
      if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      const frame = bytes(data);
      if (frame[0] === BINARY_KIND_THUMB) return deps.thumbs?.frame(studentId, frame);
      return deps.evidence.chunk(studentId, frame);
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
      // The key is namespaced so an app id can never collide with agent evidence keys.
      const stored =
        deps.recorder.record({
          examId,
          examStudentId: studentId,
          type: message.type,
          source: 'app',
          details: message.details,
          serverTs: now(),
          clientTs: message.clientTs,
          dedupeKey: `app:${message.dedupeKey}`,
        }) !== null;
      // Stored first, so the lock always has its event; a resend locks nothing again.
      if (stored && message.type === 'agent_lost') deps.onAgentLost?.(studentId);
      return send({ t: 'event.ack', id: message.id });
    }
    if (message.t === 'ack') {
      if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      return deps.messages?.ack(studentId, message.id);
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
    if (message.t === 'rtc.signal') {
      if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      return deps.liveViews?.fromStudent(studentId, message.sessionId, message.data);
    }
    if (message.t === 'live.state') {
      if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      return deps.liveViews?.studentState(studentId, message.sessionId, message.status);
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
    // A new socket has no peer connection: live views of an earlier one are over.
    deps.liveViews?.onStudentGone(student.id);
    send({ t: 'welcome', serverTime: now(), state: deps.sessionState(student.id) });
    deps.thumbs?.onWelcome(student.id);
    deps.messages?.onWelcome(student.id);
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
}
