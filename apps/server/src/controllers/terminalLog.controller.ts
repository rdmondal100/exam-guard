import type { Request, Response } from 'express';
import type { TerminalLogResponse } from '@examguard/shared';
import type { EventRepo } from '../db/repositories/event.repo.js';
import type { ExamStudentRepo } from '../db/repositories/examStudent.repo.js';
import type { TerminalLogRepo } from '../db/repositories/terminalLog.repo.js';
import { ApiError } from '../utils/ApiError.js';

/** The event types shown in a student's terminal log. */
export const TERMINAL_EVENT_TYPES = [
  'terminal_opened',
  'terminal_closed',
  'terminal_command',
  'package_installed',
] as const;

export interface TerminalLogControllerDeps {
  students: ExamStudentRepo;
  events: EventRepo;
  terminalLogs: TerminalLogRepo;
}

/** A student's terminal log. Works in any exam state, so logs stay readable. */
export function createTerminalLogController({
  students,
  events,
  terminalLogs,
}: TerminalLogControllerDeps) {
  return {
    get(req: Request<{ id: string; sid: string }>, res: Response): void {
      const student = students.findById(req.params.sid);
      if (!student || student.examId !== req.params.id) {
        throw new ApiError(404, 'not_found', 'Student not found in this exam');
      }
      const transcript = terminalLogs.transcript(student.id);
      const body: TerminalLogResponse = {
        events: events.listForStudent(student.id, TERMINAL_EVENT_TYPES),
        transcript: transcript.text,
        truncated: transcript.truncated,
      };
      res.json(body);
    },
  };
}
