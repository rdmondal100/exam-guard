import { createServer } from 'node:https';
import express, { type Express } from 'express';
import { MAX_WS_FRAME_BYTES, type StudentInfo } from '@examguard/shared';
import type { AnswerRepo } from './db/repositories/answer.repo.js';
import type { EventRepo } from './db/repositories/event.repo.js';
import type { ExamRepo } from './db/repositories/exam.repo.js';
import type { ExamStudentRepo } from './db/repositories/examStudent.repo.js';
import type { TerminalLogRepo } from './db/repositories/terminalLog.repo.js';
import { jsonBody } from './middlewares/body.middleware.js';
import { errorHandler, notFound } from './middlewares/error.middleware.js';
import { studentRoutes } from './routes/student.routes.js';
import type { AnswerIntakeDeps } from './services/answers/answer-intake.js';
import type { ExamFileService } from './services/exam-files/exam-file-service.js';
import type { JoinService } from './services/join/join-service.js';
import type { SessionHub } from './sockets/sessionHub.js';
import { onStudentSocket, type StudentSocketDeps } from './sockets/student.socket.js';
import { attachWebSocket } from './sockets/wsServer.js';
import { httpListener, type HttpListener } from './utils/httpListener.js';
import type { ServerCert } from './utils/tls/cert.js';

export interface StudentAppDeps {
  cert: ServerCert;
  /** The hosted exam, or `null` when nothing is hosted. */
  current: () => { examTitle: string; state: StudentInfo['state'] } | null;
  join: JoinService;
  /** Used to look up a session token. */
  students: ExamStudentRepo;
  /** The teacher's exam files for a student to download. Without it there is no route. */
  files?: { exams: ExamRepo; files: ExamFileService };
  /** The stored answers a restarted student app asks for. Without it there is no route. */
  answers?: AnswerRepo;
  /** Live sockets. Without it there is no `/ws`. */
  live?: {
    hub: SessionHub;
    students: ExamStudentRepo;
    events: EventRepo;
    terminalLogs: TerminalLogRepo;
    answers: AnswerIntakeDeps;
    examId: () => string | null;
  } & Pick<
    StudentSocketDeps,
    'sessionState' | 'submissions' | 'evidence' | 'now' | 'helloTimeoutMs' | 'idleMs'
  >;
}

export interface StudentApp extends HttpListener {
  app: Express;
}

/** Student-facing HTTPS listener: `/info`, join, files, answers and the `/ws` session socket. */
export function buildStudentApp({
  cert,
  current,
  join,
  students,
  files,
  answers,
  live,
}: StudentAppDeps): StudentApp {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(jsonBody);
  app.use(
    '/api/v1',
    studentRoutes({
      current,
      fpCode: cert.fpCode,
      join,
      students,
      ...(files ? { exams: files.exams, files: files.files } : {}),
      ...(answers ? { answers } : {}),
    }),
  );
  app.use(notFound);
  app.use(errorHandler);

  const server = createServer({ key: cert.key, cert: cert.cert }, app);
  const ws =
    live &&
    attachWebSocket(server, { maxPayload: MAX_WS_FRAME_BYTES }, (socket) =>
      onStudentSocket(socket, live),
    );
  const listener = httpListener(server, () => {});
  return {
    ...listener,
    close: async () => {
      ws?.close();
      await listener.close();
    },
    app,
  };
}
