import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { RosterResponse } from '@examguard/shared';
import type { ExamRepo } from '../db/exam-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import { sendError } from './errors.js';

export interface RosterRoutesDeps {
  exams: ExamRepo;
  students: ExamStudentRepo;
  requireLogin: preHandlerAsyncHookHandler;
}

/** `GET /exams/:id/roster`: the same data the teacher WS pushes, as a snapshot. */
export function registerRosterRoutes(
  app: FastifyInstance,
  { exams, students, requireLogin }: RosterRoutesDeps,
): void {
  app.get<{ Params: { id: string } }>(
    '/api/v1/exams/:id/roster',
    { preHandler: requireLogin },
    async (request, reply): Promise<RosterResponse | undefined> => {
      if (!exams.get(request.params.id)) {
        sendError(reply, 404, 'not_found', 'Exam not found');
        return undefined;
      }
      return {
        students: students.roster(request.params.id),
        counts: students.counts(request.params.id),
      };
    },
  );
}
