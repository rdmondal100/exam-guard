import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { EXAM_FILE_LIMITS } from '@examguard/shared';
import type { ExamRepo } from '../db/exam-repo.js';
import { isEditable } from '../exams/exam-state.js';
import { ExamFileError, type ExamFileService } from '../exam-files/exam-file-service.js';
import { sendError } from './errors.js';

export interface ExamFileRoutesDeps {
  exams: ExamRepo;
  files: ExamFileService;
  requireLogin: preHandlerAsyncHookHandler;
  now?: () => number;
}

function fail(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof ExamFileError) return sendError(reply, e.status, e.code, e.message);
  throw e;
}

/**
 * `/exams/:id/files*`: the files the teacher attaches to an exam. The upload is the raw file as
 * `application/octet-stream` with the name in `?name=`, so no base64 and no multipart. Writes need
 * a draft or ready exam, like the questions.
 */
export function registerExamFileRoutes(
  app: FastifyInstance,
  { exams, files, requireLogin, now = Date.now }: ExamFileRoutesDeps,
): void {
  const guarded = { preHandler: requireLogin };

  // Own scope: the raw-body parser and the 413 text apply to these routes only.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/octet-stream',
      // One byte over the limit gets through, so the service answers with its own message.
      { parseAs: 'buffer', bodyLimit: EXAM_FILE_LIMITS.fileBytes + 1 },
      (_request, body, done) => done(null, body),
    );
    scope.setErrorHandler((error, _request, reply) => {
      if ((error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return sendError(reply, 413, 'file_too_large', 'That file is too large');
      }
      return reply.send(error);
    });

    scope.get<{ Params: { id: string } }>(
      '/api/v1/exams/:id/files',
      guarded,
      async (request, reply) => {
        if (!exams.get(request.params.id)) {
          return sendError(reply, 404, 'not_found', 'Exam not found');
        }
        return files.list(request.params.id);
      },
    );

    scope.post<{ Params: { id: string }; Querystring: { name?: string } }>(
      '/api/v1/exams/:id/files',
      guarded,
      async (request, reply) => {
        const exam = exams.get(request.params.id);
        if (!exam) return sendError(reply, 404, 'not_found', 'Exam not found');
        if (!isEditable(exam.state)) {
          return sendError(reply, 409, 'invalid_state', `A ${exam.state} exam cannot be edited`);
        }
        const data = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        try {
          const file = await files.add(exam.id, request.query.name ?? '', data, now());
          return reply.code(201).send(file);
        } catch (e) {
          return fail(reply, e);
        }
      },
    );

    scope.delete<{ Params: { id: string; fileId: string } }>(
      '/api/v1/exams/:id/files/:fileId',
      guarded,
      async (request, reply) => {
        const exam = exams.get(request.params.id);
        if (!exam) return sendError(reply, 404, 'not_found', 'Exam not found');
        if (!isEditable(exam.state)) {
          return sendError(reply, 409, 'invalid_state', `A ${exam.state} exam cannot be edited`);
        }
        if (!(await files.remove(exam.id, request.params.fileId))) {
          return sendError(reply, 404, 'not_found', 'File not found');
        }
        return { ok: true };
      },
    );
  });
}
