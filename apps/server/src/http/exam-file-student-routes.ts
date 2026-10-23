import type { FastifyInstance } from 'fastify';
import type { ExamRepo } from '../db/exam-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import type { ExamFileService } from '../exam-files/exam-file-service.js';
import { hashToken } from '../join/join-service.js';
import { bearer } from './bearer.js';
import { sendError } from './errors.js';

export interface ExamFileStudentDeps {
  exams: ExamRepo;
  students: ExamStudentRepo;
  files: ExamFileService;
}

/**
 * `GET /api/v1/exam-files/:fileId` for a student (session token, like `/join/confirm`). Only a
 * file of the student's own exam, only while it is hosted or running, and only if the teacher
 * left the Files switch on. The bytes are streamed; the manifest with the hash came in `welcome`.
 */
export function registerExamFileStudentRoutes(
  app: FastifyInstance,
  { exams, students, files }: ExamFileStudentDeps,
): void {
  app.get<{ Params: { fileId: string } }>('/api/v1/exam-files/:fileId', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    const session = token ? students.findByTokenHash(hashToken(token)) : undefined;
    if (!session) return sendError(reply, 401, 'unauthorized', 'Sign in again');
    const exam = exams.get(session.examId);
    if (!exam) return sendError(reply, 404, 'not_found', 'Exam not found');
    if (exam.state !== 'hosting' && exam.state !== 'running') {
      return sendError(reply, 409, 'invalid_state', 'The exam is not open');
    }
    if (!exam.filesEnabled) return sendError(reply, 403, 'files_off', 'Files are turned off');
    const file = files.get(exam.id, request.params.fileId);
    if (!file) return sendError(reply, 404, 'not_found', 'File not found');
    const stream = await files.open(exam.id, file);
    if (!stream) return sendError(reply, 404, 'file_missing', 'The file is missing on the server');
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-length', file.size)
      .header('x-sha256', file.sha256)
      .send(stream);
  });
}
