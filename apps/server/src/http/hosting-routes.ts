import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { HostingError, type HostingManager } from '../hosting/hosting-manager.js';
import { sendError } from './errors.js';

export interface HostingRoutesDeps {
  hosting: HostingManager;
  requireLogin: preHandlerAsyncHookHandler;
}

function fail(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof HostingError) return sendError(reply, e.status, e.code, e.message, e.details);
  throw e;
}

/** `/exams/:id/host`, `/stop-hosting`, `/hosting` and `/start` and `/end`. */
export function registerHostingRoutes(
  app: FastifyInstance,
  { hosting, requireLogin }: HostingRoutesDeps,
): void {
  const guarded = { preHandler: requireLogin };

  app.post<{ Params: { id: string } }>(
    '/api/v1/exams/:id/host',
    guarded,
    async (request, reply) => {
      try {
        return await hosting.start(request.params.id);
      } catch (e) {
        return fail(reply, e);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/exams/:id/stop-hosting',
    guarded,
    async (request, reply) => {
      try {
        await hosting.stop(request.params.id);
        return { ok: true };
      } catch (e) {
        return fail(reply, e);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/exams/:id/start',
    guarded,
    async (request, reply) => {
      try {
        return hosting.startExam(request.params.id);
      } catch (e) {
        return fail(reply, e);
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/v1/exams/:id/end', guarded, async (request, reply) => {
    try {
      await hosting.endExam(request.params.id, 'manual');
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/exams/:id/hosting',
    guarded,
    async (request, reply) => {
      return hosting.info(request.params.id) ?? sendError(reply, 404, 'not_hosting', 'Not hosting');
    },
  );
}
