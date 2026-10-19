import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { ExamCreateBodySchema, ExamUpdateBodySchema } from '@examguard/shared';
import type { ExamRepo } from '../db/exam-repo.js';
import { isEditable } from '../exams/exam-state.js';
import { sendError } from './errors.js';

export interface ExamRoutesDeps {
  exams: ExamRepo;
  requireLogin: preHandlerAsyncHookHandler;
  now?: () => number;
}

/** `/exams*`: list, create, edit settings, duplicate and delete. Hosting and more come later. */
export function registerExamRoutes(
  app: FastifyInstance,
  { exams, requireLogin, now = Date.now }: ExamRoutesDeps,
): void {
  const guarded = { preHandler: requireLogin };

  app.get('/api/v1/exams', guarded, async () => exams.list());

  app.get<{ Params: { id: string } }>('/api/v1/exams/:id', guarded, async (request, reply) => {
    return exams.get(request.params.id) ?? sendError(reply, 404, 'not_found', 'Exam not found');
  });

  app.post('/api/v1/exams', guarded, async (request, reply) => {
    const body = ExamCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'invalid_body', 'A title and a duration of 1–600 minutes');
    }
    if (body.data.classListId != null && !exams.classListExists(body.data.classListId)) {
      return sendError(reply, 400, 'class_list_not_found', 'That class list does not exist');
    }
    return reply.code(201).send(exams.create(body.data, now()));
  });

  app.patch<{ Params: { id: string } }>('/api/v1/exams/:id', guarded, async (request, reply) => {
    const body = ExamUpdateBodySchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 400, 'invalid_body', 'Invalid exam settings');
    const current = exams.get(request.params.id);
    if (!current) return sendError(reply, 404, 'not_found', 'Exam not found');
    if (!isEditable(current.state)) {
      return sendError(reply, 409, 'invalid_state', `A ${current.state} exam cannot be edited`);
    }
    if (body.data.classListId != null && !exams.classListExists(body.data.classListId)) {
      return sendError(reply, 400, 'class_list_not_found', 'That class list does not exist');
    }
    return exams.update(current.id, body.data, now());
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/exams/:id/duplicate',
    guarded,
    async (request, reply) => {
      const copy = exams.duplicate(request.params.id, now());
      if (!copy) return sendError(reply, 404, 'not_found', 'Exam not found');
      return reply.code(201).send(copy);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/v1/exams/:id', guarded, async (request, reply) => {
    const current = exams.get(request.params.id);
    if (!current) return sendError(reply, 404, 'not_found', 'Exam not found');
    if (!isEditable(current.state)) {
      return sendError(reply, 409, 'invalid_state', `A ${current.state} exam cannot be deleted`);
    }
    exams.delete(current.id);
    return { ok: true };
  });
}
