import type { FastifyInstance } from 'fastify';
import type { AnswerRepo } from '../db/repositories/answer.repo.js';
import type { ExamStudentRepo } from '../db/repositories/examStudent.repo.js';
import { hashToken } from '../services/join/join-service.js';
import { bearer } from '../middlewares/studentAuth.middleware.js';
import { sendError } from '../utils/ApiError.js';

export interface AnswerStudentDeps {
  students: ExamStudentRepo;
  answers: AnswerRepo;
}

/**
 * `GET /api/v1/answers/latest` for a student (session token): the newest stored version of each of
 * their buffers, so a restarted app can fill its editors again. It is HTTP and not part of
 * `welcome` because the client caps a WS frame at 512 KB and one buffer can be 128 K characters.
 */
export function registerAnswerStudentRoutes(
  app: FastifyInstance,
  { students, answers }: AnswerStudentDeps,
): void {
  app.get('/api/v1/answers/latest', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    const session = token ? students.findByTokenHash(hashToken(token)) : undefined;
    if (!session) return sendError(reply, 401, 'unauthorized', 'Sign in again');
    return answers.snapshot(session.id);
  });
}
