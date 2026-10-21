import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import {
  HELLO_TIMEOUT_MS,
  STUDENT_IDLE_MS,
  StudentMessageSchema,
  WS_CLOSE,
  isProtocolCompatible,
  type ServerToStudent,
  type SessionState,
} from '@examguard/shared';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import { hashToken } from '../join/join-service.js';
import type { SessionHub, StudentConn } from './session-hub.js';

export interface StudentSocketDeps {
  hub: SessionHub;
  students: ExamStudentRepo;
  /** The state the client should show; also activates a late joiner. */
  sessionState: (studentId: string) => SessionState;
  /** The hosted exam id, or `null` when nothing is hosted. */
  examId: () => string | null;
  now?: () => number;
  helloTimeoutMs?: number;
  idleMs?: number;
}

const text = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.from(data as Buffer).toString('utf8');

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

    socket.on('message', (data: RawData) => {
      lastFrame = now();
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
      if (studentId) return refuse(WS_CLOSE.badHello, 'bad_frame', 'Already said hello');

      if (!isProtocolCompatible(message.protocol)) {
        return refuse(
          WS_CLOSE.protocolMismatch,
          'protocol_mismatch',
          "Update ExamGuard to match the teacher's version",
        );
      }
      const examId = deps.examId();
      if (!examId) return refuse(WS_CLOSE.notHosting, 'not_hosting', 'No exam is being hosted');
      const student = deps.students.findByTokenHash(hashToken(message.token));
      if (!student || student.examId !== examId) {
        return refuse(WS_CLOSE.unauthorized, 'unauthorized', 'Sign in again');
      }
      studentId = student.id;
      clearTimeout(helloTimer);
      deps.hub.attach(student.id, conn, WS_CLOSE.replaced);
      send({ t: 'welcome', serverTime: now(), state: deps.sessionState(student.id) });
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(sweep);
      if (studentId) deps.hub.detach(studentId, conn);
    });
    socket.on('error', () => socket.terminate());
  });
}
