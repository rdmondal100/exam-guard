import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import {
  ClassListImportBodySchema,
  MAX_CLASS_LIST_ROWS,
  type ClassListImportResult,
} from '@examguard/shared';
import { parseClassCsv } from '../class-lists/csv-parser.js';
import type { ClassListRepo } from '../db/class-list-repo.js';
import { sendError } from './errors.js';

export interface ClassListRoutesDeps {
  classLists: ClassListRepo;
  requireLogin: preHandlerAsyncHookHandler;
  now?: () => number;
}

/** `/class-lists*`: CSV import with a dry-run preview, listing and delete. */
export function registerClassListRoutes(
  app: FastifyInstance,
  { classLists, requireLogin, now = Date.now }: ClassListRoutesDeps,
): void {
  const guarded = { preHandler: requireLogin };

  app.get('/api/v1/class-lists', guarded, async () => classLists.list());

  app.post(
    '/api/v1/class-lists/import',
    { ...guarded, bodyLimit: 2_000_000 },
    async (request, reply) => {
      const body = ClassListImportBodySchema.safeParse(request.body);
      if (!body.success) {
        return sendError(reply, 400, 'invalid_body', 'A list name and the CSV text are required');
      }
      const { rows, errors } = parseClassCsv(body.data.csvText);
      if (rows.length === 0) {
        return sendError(reply, 400, 'no_valid_rows', 'The file has no valid student rows', {
          errors,
        });
      }
      if (rows.length > MAX_CLASS_LIST_ROWS) {
        return sendError(reply, 400, 'too_many_rows', `At most ${MAX_CLASS_LIST_ROWS} students`);
      }
      if (body.data.dryRun === true) {
        const preview: ClassListImportResult = { rows, errors };
        return preview;
      }
      const list = classLists.create(body.data.name, rows, now());
      const saved: ClassListImportResult = { list, rows, errors };
      return saved;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/class-lists/:id/students',
    guarded,
    async (request, reply) => {
      const students = classLists.students(request.params.id);
      if (students === undefined) return sendError(reply, 404, 'not_found', 'Class list not found');
      return students;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/class-lists/:id',
    guarded,
    async (request, reply) => {
      const result = classLists.delete(request.params.id);
      if (result === 'not_found') return sendError(reply, 404, 'not_found', 'Class list not found');
      if (result === 'in_use') {
        return sendError(reply, 409, 'list_in_use', 'An exam uses this class list');
      }
      return { ok: true };
    },
  );
}
