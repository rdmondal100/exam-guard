import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, TEACHER_TOKEN_HEADER } from '@examguard/shared';
import { AuthState } from '../auth/auth-state.js';
import { LoginLimiter } from '../auth/login-limiter.js';
import { ClassListRepo } from '../db/class-list-repo.js';
import type { Db } from '../db/connection.js';
import { AnswerWriter } from '../answers/answer-writer.js';
import { AnswerRepo } from '../db/answer-repo.js';
import { EventRepo } from '../db/event-repo.js';
import { ExamFileRepo } from '../db/exam-file-repo.js';
import { ExamRepo } from '../db/exam-repo.js';
import { ExamStudentRepo } from '../db/exam-student-repo.js';
import { ExamFileService } from '../exam-files/exam-file-service.js';
import { ExamFileStore } from '../exam-files/exam-file-store.js';
import { HostingManager, type HostingManagerDeps } from '../hosting/hosting-manager.js';
import { QuestionRepo } from '../db/question-repo.js';
import { TeacherActionRepo } from '../db/teacher-action-repo.js';
import { TerminalLogRepo } from '../db/terminal-log-repo.js';
import { TerminalRepo } from '../db/terminal-repo.js';
import { TeacherRepo } from '../db/teacher-repo.js';
import { registerActionRoutes } from './action-routes.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerClassListRoutes } from './class-list-routes.js';
import { sendError } from './errors.js';
import { registerExamFileRoutes } from './exam-file-routes.js';
import { registerExamRoutes } from './exam-routes.js';
import { registerHostingRoutes } from './hosting-routes.js';
import { registerQuestionRoutes } from './question-routes.js';
import { registerRosterRoutes } from './roster-routes.js';
import { registerTerminalLogRoutes } from './terminal-log-routes.js';
import { SessionHub } from '../ws/session-hub.js';
import { registerTeacherSocket } from '../ws/teacher-socket.js';

export interface TeacherAppOptions {
  token: string;
  db: Db;
  /** Clock for the login rate limiter and the teacher row; tests inject a fake. */
  now?: () => number;
  /** Where the teacher's exam files are kept. Defaults to `exam-files` in the hosting data folder. */
  filesDir?: string;
  /** Student listener settings. Without it the hosting routes are not registered. */
  hosting?: Omit<
    HostingManagerDeps,
    | 'exams'
    | 'questions'
    | 'students'
    | 'events'
    | 'terminals'
    | 'terminalLogs'
    | 'answers'
    | 'answerWriter'
    | 'actions'
    | 'examFiles'
    | 'hub'
  >;
}

export interface TeacherApp {
  app: FastifyInstance;
  /** `preHandler` for every route that needs a logged-in teacher. */
  requireLogin: AuthState['requireLogin'];
  /** Present when `hosting` options were given. */
  hosting?: HostingManager;
}

function tokenMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Loopback API for the teacher UI. Every route needs the per-launch token; routes other than
 * `/health` and `/auth/*` also need `requireLogin`.
 */
export function buildTeacherApp({
  token,
  db,
  now,
  filesDir,
  hosting: hostingOptions,
}: TeacherAppOptions): TeacherApp {
  // Live sockets must not hold shutdown open.
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const state = new AuthState();

  // The renderer is a different origin (dev server or file://), and the token header makes
  // every call a preflighted request. The preflight carries no token, so answer it before the
  // token check. The listener is loopback-only and every real call still needs the token.
  app.addHook('onRequest', async (request, reply) => {
    void reply.header('access-control-allow-origin', '*');
    if (request.method === 'OPTIONS') {
      return reply
        .header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        .header('access-control-allow-headers', `${TEACHER_TOKEN_HEADER}, content-type`)
        .header('access-control-max-age', '600')
        .code(204)
        .send();
    }
    return undefined;
  });

  app.addHook('onRequest', async (request, reply) => {
    // `/ws` checks the token itself (a browser WebSocket cannot set headers).
    if (request.url.split('?', 1)[0] === '/ws') return undefined;
    if (!tokenMatches(token, request.headers[TEACHER_TOKEN_HEADER])) {
      return sendError(reply, 401, 'unauthorized', 'Missing or invalid teacher token');
    }
    return undefined;
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    protocol: PROTOCOL_VERSION,
    uptimeSec: Math.round(process.uptime()),
  }));

  registerAuthRoutes(app, {
    teacher: new TeacherRepo(db),
    state,
    limiter: new LoginLimiter(now),
    now,
  });

  registerClassListRoutes(app, {
    classLists: new ClassListRepo(db),
    requireLogin: state.requireLogin,
    now,
  });

  const exams = new ExamRepo(db);
  const questions = new QuestionRepo(db);
  const examFilesDir = filesDir ?? (hostingOptions && join(hostingOptions.dataDir, 'exam-files'));
  const examFiles = examFilesDir
    ? new ExamFileService(new ExamFileRepo(db), new ExamFileStore(examFilesDir))
    : undefined;
  registerExamRoutes(app, { exams, questions, examFiles, requireLogin: state.requireLogin, now });
  if (examFiles) {
    registerExamFileRoutes(app, { exams, files: examFiles, requireLogin: state.requireLogin, now });
  }
  registerQuestionRoutes(app, { exams, questions, requireLogin: state.requireLogin, now });

  const students = new ExamStudentRepo(db);
  const events = new EventRepo(db);
  const terminalLogs = new TerminalLogRepo(db);
  const answers = new AnswerRepo(db);
  registerTerminalLogRoutes(app, {
    students,
    events,
    terminalLogs,
    requireLogin: state.requireLogin,
  });

  let hosting: HostingManager | undefined;
  if (hostingOptions && examFiles) {
    const hub = new SessionHub({ students, now });
    hosting = new HostingManager({
      exams,
      questions,
      students,
      events,
      terminals: new TerminalRepo(db),
      terminalLogs,
      answers,
      answerWriter: new AnswerWriter(answers, {
        onRejected: (row, error) =>
          console.warn(
            `answer save ${row.clientSeq} refused: ${error instanceof Error ? error.message : String(error)}`,
          ),
      }),
      actions: new TeacherActionRepo(db),
      examFiles,
      hub,
      now,
      ...hostingOptions,
    });
    registerHostingRoutes(app, { hosting, requireLogin: state.requireLogin });
    registerRosterRoutes(app, { exams, students, requireLogin: state.requireLogin });
    registerActionRoutes(app, { hosting, requireLogin: state.requireLogin });
    void app.register(websocket);
    // Inside a plugin so it loads after the websocket plugin.
    void app.register(async (scope) => {
      registerTeacherSocket(scope, {
        hub,
        allowed: (request) =>
          state.isLoggedIn() &&
          tokenMatches(token, new URL(request.url, 'http://x').searchParams.get('token')),
      });
    });
    const manager = hosting;
    app.addHook('onClose', async () => {
      await manager.close();
      hub.dispose();
    });
  }

  return { app, requireLogin: state.requireLogin, hosting };
}
