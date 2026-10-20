import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type StudentInfo } from '@examguard/shared';
import type { ServerCert } from '../tls/cert.js';
import type { JoinService } from '../join/join-service.js';
import { sendError } from './errors.js';
import { registerJoinRoutes } from './join-routes.js';

export interface StudentAppDeps {
  cert: ServerCert;
  /** The hosted exam, or `null` when nothing is hosted. */
  current: () => { examTitle: string; state: StudentInfo['state'] } | null;
  join: JoinService;
}

/** Student-facing HTTPS app: `/info` and join. WS and the rest arrive in later milestones. */
export function buildStudentApp({ cert, current, join }: StudentAppDeps): FastifyInstance {
  const app = Fastify({ logger: false, https: { key: cert.key, cert: cert.cert } });

  app.get('/api/v1/info', async (_request, reply) => {
    const exam = current();
    if (!exam) return sendError(reply, 503, 'not_hosting', 'No exam is being hosted');
    const info: StudentInfo = { ...exam, protocol: PROTOCOL_VERSION, fpCode: cert.fpCode };
    return info;
  });

  registerJoinRoutes(app, join);

  return app;
}
