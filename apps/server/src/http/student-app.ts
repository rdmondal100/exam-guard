import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type StudentInfo } from '@examguard/shared';
import type { ServerCert } from '../tls/cert.js';
import { sendError } from './errors.js';

export interface StudentAppDeps {
  cert: ServerCert;
  /** The hosted exam, or `null` when nothing is hosted. */
  current: () => { examTitle: string; state: StudentInfo['state'] } | null;
}

/** Student-facing HTTPS app. Join, WS and the rest arrive in later milestones. */
export function buildStudentApp({ cert, current }: StudentAppDeps): FastifyInstance {
  const app = Fastify({ logger: false, https: { key: cert.key, cert: cert.cert } });

  app.get('/api/v1/info', async (_request, reply) => {
    const exam = current();
    if (!exam) return sendError(reply, 503, 'not_hosting', 'No exam is being hosted');
    const info: StudentInfo = { ...exam, protocol: PROTOCOL_VERSION, fpCode: cert.fpCode };
    return info;
  });

  return app;
}
