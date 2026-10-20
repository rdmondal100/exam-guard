import type { FastifyInstance, FastifyReply } from 'fastify';
import { JoinConfirmRequestSchema, JoinRequestSchema } from '@examguard/shared';
import { JoinError, type JoinService } from '../join/join-service.js';
import { sendError } from './errors.js';

function fail(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof JoinError) return sendError(reply, e.status, e.code, e.message, e.details);
  throw e;
}

function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  return match?.[1];
}

/** Student API `POST /join` and `POST /join/confirm`. */
export function registerJoinRoutes(app: FastifyInstance, join: JoinService): void {
  app.post('/api/v1/join', async (request, reply) => {
    const body = JoinRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 400, 'invalid_body', 'Check the student ID and PIN');
    try {
      return join.join(body.data, request.ip);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/v1/join/confirm', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    if (!token) return sendError(reply, 401, 'unauthorized', 'Sign in again');
    const body = JoinConfirmRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'invalid_body', 'The monitoring notice must be accepted');
    }
    try {
      return { ok: true, state: join.confirm(token) };
    } catch (e) {
      return fail(reply, e);
    }
  });
}
