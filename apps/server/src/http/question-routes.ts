import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { QuestionBodySchema, ReorderBodySchema } from '@examguard/shared';
import type { ExamRepo } from '../db/exam-repo.js';
import type { QuestionRepo } from '../db/question-repo.js';
import { isEditable } from '../exams/exam-state.js';
import { sendError } from './errors.js';

export interface QuestionRoutesDeps {
  exams: ExamRepo;
  questions: QuestionRepo;
  requireLogin: preHandlerAsyncHookHandler;
  now?: () => number;
}

/** `/exams/:id/questions*` and `/questions/:qid`. Writes need a draft or ready exam. */
export function registerQuestionRoutes(
  app: FastifyInstance,
  { exams, questions, requireLogin, now = Date.now }: QuestionRoutesDeps,
): void {
  const guarded = { preHandler: requireLogin };
  const invalidBody = 'Invalid question: check the text, languages and criteria (0.5 steps)';

  app.get<{ Params: { id: string } }>(
    '/api/v1/exams/:id/questions',
    guarded,
    async (request, reply) => {
      if (!exams.get(request.params.id))
        return sendError(reply, 404, 'not_found', 'Exam not found');
      return questions.list(request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/exams/:id/questions',
    guarded,
    async (request, reply) => {
      const exam = exams.get(request.params.id);
      if (!exam) return sendError(reply, 404, 'not_found', 'Exam not found');
      if (!isEditable(exam.state)) {
        return sendError(reply, 409, 'invalid_state', `A ${exam.state} exam cannot be edited`);
      }
      const body = QuestionBodySchema.safeParse(request.body);
      if (!body.success) return sendError(reply, 400, 'invalid_body', invalidBody);
      return reply.code(201).send(questions.create(exam.id, body.data, now()));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/exams/:id/questions/reorder',
    guarded,
    async (request, reply) => {
      const exam = exams.get(request.params.id);
      if (!exam) return sendError(reply, 404, 'not_found', 'Exam not found');
      if (!isEditable(exam.state)) {
        return sendError(reply, 409, 'invalid_state', `A ${exam.state} exam cannot be edited`);
      }
      const body = ReorderBodySchema.safeParse(request.body);
      if (!body.success || !questions.reorder(exam.id, body.data.ids)) {
        return sendError(reply, 400, 'invalid_body', 'ids must list every question exactly once');
      }
      return questions.list(exam.id);
    },
  );

  app.patch<{ Params: { qid: string } }>(
    '/api/v1/questions/:qid',
    guarded,
    async (request, reply) => {
      const current = questions.get(request.params.qid);
      const exam = current && exams.get(current.examId);
      if (!current || !exam) return sendError(reply, 404, 'not_found', 'Question not found');
      if (!isEditable(exam.state)) {
        return sendError(reply, 409, 'invalid_state', `A ${exam.state} exam cannot be edited`);
      }
      const body = QuestionBodySchema.safeParse(request.body);
      if (!body.success) return sendError(reply, 400, 'invalid_body', invalidBody);
      return questions.update(current.id, body.data, now());
    },
  );

  app.delete<{ Params: { qid: string } }>(
    '/api/v1/questions/:qid',
    guarded,
    async (request, reply) => {
      const current = questions.get(request.params.qid);
      const exam = current && exams.get(current.examId);
      if (!current || !exam) return sendError(reply, 404, 'not_found', 'Question not found');
      if (!isEditable(exam.state)) {
        return sendError(reply, 409, 'invalid_state', `A ${exam.state} exam cannot be edited`);
      }
      questions.delete(current.id);
      return { ok: true };
    },
  );
}
