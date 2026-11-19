import type { RawData, WebSocket } from 'ws';
import {
  BINARY_KIND_THUMB,
  HELLO_TIMEOUT_MS,
  STUDENT_IDLE_MS,
  StudentMessageSchema,
  WS_CLOSE,
  isEvidenceKind,
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
import { studentBuckets, type MeteredFrame } from './rateLimit.js';

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
  /** What the app's monitor saw: screenshot chunks (binary frames) and the events that name them (M22). */
  evidence: Pick<EvidenceIntake, 'chunk' | 'report' | 'forget'>;
  /** Grid thumbnails (binary kind 1) and who is asked to stream them (M29, M33). */
  thumbs?: Pick<ThumbRelay, 'frame' | 'onWelcome'>;
  /** WebRTC live view signaling (M30, M34). */
  liveViews?: Pick<LiveRelay, 'fromStudent' | 'studentState' | 'onStudentGone'>;
  /** Teacher messages: re-sent after each welcome until the app acks them (M35). */
  messages?: Pick<TeacherMessages, 'onWelcome' | 'ack'>;
  /** The state the client should show; also activates a late joiner. */
  sessionState: (studentId: string) => SessionState;
  /** The hosted exam id, or `null` when nothing is hosted. */
  examId: () => string | null;
  now?: () => number;
  /** A frame that could not be handled (a database error, say): logged, the socket stays (M62). */
  onError?: (error: unknown, context: string) => void;
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
  // A practice exam (M53) records nothing, terminal logs included.
  let practice = false;
  const buckets = studentBuckets(now);
  /** `false` when the frame is over its rate: it is dropped unacked and the app re-sends it later. */
  const allowed = (kind: MeteredFrame) => buckets[kind].take();
  const onError =
    deps.onError ??
    ((error: unknown, context: string) => console.error(`[student socket] ${context}`, error));
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

  const handle = (data: RawData, isBinary: boolean) => {
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
    if (!parsed.success) {
      // Before hello a bad frame ends the socket. After it, one bad frame (a newer app, a
      // readiness report with an odd value) is dropped: closing would make the app reconnect and
      // send the same frame again, forever.
      if (!studentId) return refuse(WS_CLOSE.badHello, 'bad_frame', 'Unknown message');
      return onError(parsed.error.issues.slice(0, 3), 'dropped an invalid frame');
    }
    const message = parsed.data;

    if (message.t === 'ping') {
      if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      return send({ t: 'pong', clientSent: message.clientSent, serverTime: now() });
    }
    if (message.t === 'event') {
      if (!studentId || !examId)
        return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      if (!allowed('event')) return;
      if (isEvidenceKind(message.type)) {
        deps.evidence.report(examId, studentId, message);
        return send({ t: 'event.ack', id: message.id });
      }
      // The key is namespaced by source and student, so an app id can never collide with monitor
      // evidence keys or with another student's events.
      deps.recorder.record({
        examId,
        examStudentId: studentId,
        type: message.type,
        source: 'app',
        details: message.details,
        serverTs: now(),
        clientTs: message.clientTs,
        dedupeKey: `app:${studentId}:${message.dedupeKey}`,
      });
      return send({ t: 'event.ack', id: message.id });
    }
    if (message.t === 'ack') {
      if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      return deps.messages?.ack(studentId, message.id);
    }
    if (message.t === 'monitor.status') {
      if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      return deps.hub.setMonitor(studentId, message);
    }
    if (message.t === 'readiness.report') {
      if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      if (!allowed('readiness.report')) return;
      return deps.hub.setReadiness(studentId, message);
    }
    if (message.t === 'transcript') {
      if (!studentId) return refuse(WS_CLOSE.badHello, 'hello_first', 'Send hello first');
      if (!allowed('transcript')) return;
      // Acked even when dropped over the cap (or in a practice exam), so the client stops
      // re-sending it.
      if (!practice)
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
    // A student who has not accepted the monitoring notice is not on the roster, so the exam
    // (questions included) must not reach them.
    if (student.state === 'not_joined') {
      return refuse(WS_CLOSE.unauthorized, 'not_joined', 'Accept the monitoring notice first');
    }
    studentId = student.id;
    examId = hostedId;
    practice = deps.answers.exams.get(hostedId)?.practice === true;
    clearTimeout(helloTimer);
    deps.hub.attach(student.id, conn, WS_CLOSE.replaced);
    // A new socket has no peer connection: live views of an earlier one are over.
    deps.liveViews?.onStudentGone(student.id);
    send({ t: 'welcome', serverTime: now(), state: deps.sessionState(student.id) });
    deps.thumbs?.onWelcome(student.id);
    deps.messages?.onWelcome(student.id);
  };

  socket.on('message', (data: RawData, isBinary: boolean) => {
    lastFrame = now();
    try {
      handle(data, isBinary);
    } catch (error) {
      // A handler error (a full disk, a busy database) must not take the server down mid-exam.
      // The frame is not acked, so the app sends it again after its next welcome.
      onError(error, 'frame failed');
    }
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
