import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { TerminalLogResponse } from '@examguard/shared';
import type { EventRepo } from '../db/event-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import type { TerminalLogRepo } from '../db/terminal-log-repo.js';
import { sendError } from './errors.js';

/** The event types shown in a student's terminal log. */
export const TERMINAL_EVENT_TYPES = [
  'terminal_opened',
  'terminal_closed',
  'terminal_command',
  'package_installed',
] as const;

export interface TerminalLogRoutesDeps {
  students: ExamStudentRepo;
  events: EventRepo;
  terminalLogs: TerminalLogRepo;
  requireLogin: preHandlerAsyncHookHandler;
}

/** `GET /exams/:id/students/:sid/terminal`: works in any exam state, so logs stay readable. */
export function registerTerminalLogRoutes(
  app: FastifyInstance,
  { students, events, terminalLogs, requireLogin }: TerminalLogRoutesDeps,
): void {
  app.get<{ Params: { id: string; sid: string } }>(
    '/api/v1/exams/:id/students/:sid/terminal',
    { preHandler: requireLogin },
    async (request, reply): Promise<TerminalLogResponse | undefined> => {
      const student = students.findById(request.params.sid);
      if (!student || student.examId !== request.params.id) {
        sendError(reply, 404, 'not_found', 'Student not found in this exam');
        return undefined;
      }
      const transcript = terminalLogs.transcript(student.id);
      return {
        events: events.listForStudent(student.id, TERMINAL_EVENT_TYPES),
        transcript: transcript.text,
        truncated: transcript.truncated,
      };
    },
  );
}
