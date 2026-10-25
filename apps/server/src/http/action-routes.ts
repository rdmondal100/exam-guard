import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { ExamActionSchema } from '@examguard/shared';
import { HostingError, type HostingManager } from '../hosting/hosting-manager.js';
import { sendError } from './errors.js';

export interface ActionRoutesDeps {
  hosting: HostingManager;
  requireLogin: preHandlerAsyncHookHandler;
}

/** `POST /exams/:id/actions`: exam-wide teacher actions (`terminal`, `internet`). */
export function registerActionRoutes(
  app: FastifyInstance,
  { hosting, requireLogin }: ActionRoutesDeps,
): void {
  app.post<{ Params: { id: string } }>(
    '/api/v1/exams/:id/actions',
    { preHandler: requireLogin },
    async (request, reply) => {
      const body = ExamActionSchema.safeParse(request.body);
      if (!body.success) return sendError(reply, 400, 'invalid_body', 'Unknown or invalid action');
      const action = body.data;
      if (action.type === 'terminal' && !action.enabled && action.minutes !== undefined) {
        return sendError(reply, 400, 'invalid_body', 'Minutes only apply when turning it on');
      }
      try {
        if (action.type === 'internet') {
          return hosting.internet.set(request.params.id, action.enabled);
        }
        return hosting.terminal.set(request.params.id, action.enabled, action.minutes);
      } catch (e) {
        if (e instanceof HostingError) return sendError(reply, e.status, e.code, e.message);
        throw e;
      }
    },
  );
}
