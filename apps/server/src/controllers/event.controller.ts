import type { Request, Response } from 'express';
import type { EventsResponse } from '@examguard/shared';
import type { EventRepo } from '../db/repositories/event.repo.js';
import type { ExamRepo } from '../db/repositories/exam.repo.js';
import type { ScreenshotStore } from '../services/screenshots/screenshot-store.js';
import { ApiError } from '../utils/ApiError.js';
import { EventQuerySchema } from '../validators/event.validator.js';

export interface EventControllerDeps {
  exams: ExamRepo;
  events: EventRepo;
  /** Without it there is no screenshot route. */
  screenshots?: ScreenshotStore;
}

/** The teacher's event list and the pictures that go with it. */
export function createEventController({ exams, events, screenshots }: EventControllerDeps) {
  return {
    list(req: Request<{ id: string }>, res: Response): void {
      if (!exams.get(req.params.id)) throw new ApiError(404, 'not_found', 'Exam not found');
      const query = EventQuerySchema.safeParse(req.query);
      if (!query.success) throw new ApiError(400, 'invalid_query', 'The filter is not valid');
      const { studentId, severity, source, view, after, limit } = query.data;
      const body: EventsResponse = {
        events: events.list(req.params.id, {
          limit,
          ...(studentId ? { examStudentId: studentId } : {}),
          ...(severity ? { severity } : {}),
          ...(source ? { source } : {}),
          ...(view ? { view } : {}),
          ...(after === undefined ? {} : { after }),
        }),
      };
      res.json(body);
    },

    screenshot(req: Request<{ eventId: string }>, res: Response): void {
      const id = Number(req.params.eventId);
      const stored = Number.isInteger(id) ? events.screenshotOf(id) : undefined;
      const stream = stored && screenshots ? screenshots.open(stored.path) : null;
      if (!stream) throw new ApiError(404, 'not_found', 'No screenshot for this event');
      // A missing file must not crash the server; the stream's error ends the response.
      stream.on('error', () => res.destroy());
      res.type('image/jpeg').set('cache-control', 'private, max-age=3600');
      stream.pipe(res);
    },
  };
}
