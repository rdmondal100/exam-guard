import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { MAX_EVENTS_PER_PAGE, SeveritySchema, type EventsResponse } from '@examguard/shared';
import type { EventRepo } from '../db/event-repo.js';
import type { ExamRepo } from '../db/exam-repo.js';
import type { ScreenshotStore } from '../screenshots/screenshot-store.js';
import { sendError } from './errors.js';

const QuerySchema = z.object({
  studentId: z.string().min(1).optional(),
  severity: SeveritySchema.optional(),
  source: z.enum(['agent', 'app', 'server']).optional(),
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_EVENTS_PER_PAGE).default(200),
});

export interface EventRoutesDeps {
  exams: ExamRepo;
  events: EventRepo;
  /** Without it the screenshot route is not registered. */
  screenshots?: ScreenshotStore;
  requireLogin: preHandlerAsyncHookHandler;
}

/** The teacher's event list and the pictures that go with it. */
export function registerEventRoutes(
  app: FastifyInstance,
  { exams, events, screenshots, requireLogin }: EventRoutesDeps,
): void {
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    '/api/v1/exams/:id/events',
    { preHandler: requireLogin },
    async (request, reply): Promise<EventsResponse | undefined> => {
      if (!exams.get(request.params.id)) {
        sendError(reply, 404, 'not_found', 'Exam not found');
        return undefined;
      }
      const query = QuerySchema.safeParse(request.query);
      if (!query.success) {
        sendError(reply, 400, 'invalid_query', 'The filter is not valid');
        return undefined;
      }
      const { studentId, severity, source, after, limit } = query.data;
      return {
        events: events.list(request.params.id, {
          limit,
          ...(studentId ? { examStudentId: studentId } : {}),
          ...(severity ? { severity } : {}),
          ...(source ? { source } : {}),
          ...(after === undefined ? {} : { after }),
        }),
      };
    },
  );

  if (!screenshots) return;
  app.get<{ Params: { eventId: string } }>(
    '/api/v1/screenshots/:eventId',
    { preHandler: requireLogin },
    async (request, reply) => {
      const id = Number(request.params.eventId);
      const stored = Number.isInteger(id) ? events.screenshotOf(id) : undefined;
      const stream = stored ? screenshots.open(stored.path) : null;
      if (!stream) return sendError(reply, 404, 'not_found', 'No screenshot for this event');
      // A missing file must not crash the server; the stream's error ends the response.
      stream.on('error', () => reply.raw.destroy());
      return reply.type('image/jpeg').header('cache-control', 'private, max-age=3600').send(stream);
    },
  );
}
