import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { MAX_WS_FRAME_BYTES, PROTOCOL_VERSION, type StudentInfo } from '@examguard/shared';
import type { ServerCert } from '../tls/cert.js';
import type { JoinService } from '../join/join-service.js';
import type { EventRepo } from '../db/event-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import type { TerminalLogRepo } from '../db/terminal-log-repo.js';
import type { SessionHub } from '../ws/session-hub.js';
import { registerStudentSocket, type StudentSocketDeps } from '../ws/student-socket.js';
import { sendError } from './errors.js';
import { registerJoinRoutes } from './join-routes.js';

export interface StudentAppDeps {
  cert: ServerCert;
  /** The hosted exam, or `null` when nothing is hosted. */
  current: () => { examTitle: string; state: StudentInfo['state'] } | null;
  join: JoinService;
  /** Live sockets. Without it the WS route is not registered. */
  live?: {
    hub: SessionHub;
    students: ExamStudentRepo;
    events: EventRepo;
    terminalLogs: TerminalLogRepo;
    examId: () => string | null;
  } & Pick<StudentSocketDeps, 'sessionState' | 'now' | 'helloTimeoutMs' | 'idleMs'>;
}

/** Student-facing HTTPS app: `/info`, join and the `/ws` session socket. */
export function buildStudentApp({ cert, current, join, live }: StudentAppDeps): FastifyInstance {
  const app = Fastify({ logger: false, https: { key: cert.key, cert: cert.cert } });

  app.get('/api/v1/info', async (_request, reply) => {
    const exam = current();
    if (!exam) return sendError(reply, 503, 'not_hosting', 'No exam is being hosted');
    const info: StudentInfo = { ...exam, protocol: PROTOCOL_VERSION, fpCode: cert.fpCode };
    return info;
  });

  registerJoinRoutes(app, join);

  if (live) {
    void app.register(websocket, { options: { maxPayload: MAX_WS_FRAME_BYTES } });
    // Registered inside a plugin so it loads after the websocket plugin.
    void app.register(async (scope) => {
      registerStudentSocket(scope, live);
    });
  }

  return app;
}
