import type { Request, Response } from 'express';
import { ExamActionSchema, StudentActionSchema, type RosterResponse } from '@examguard/shared';
import type { ExamRepo } from '../db/repositories/exam.repo.js';
import type { ExamStudentRepo } from '../db/repositories/examStudent.repo.js';
import type { HostingManager } from '../services/hosting/hosting-manager.js';
import { ApiError } from '../utils/ApiError.js';

export interface HostingControllerDeps {
  hosting: HostingManager;
  exams: ExamRepo;
  students: ExamStudentRepo;
}

type IdRequest = Request<{ id: string }>;

/**
 * Hosting an exam and running it: host, stop hosting, start, end, the hosting info, the roster
 * snapshot and the exam-wide actions. A `HostingError` goes to the error middleware.
 */
export function createHostingController({ hosting, exams, students }: HostingControllerDeps) {
  return {
    async host(req: IdRequest, res: Response): Promise<void> {
      res.json(await hosting.start(req.params.id));
    },

    async stopHosting(req: IdRequest, res: Response): Promise<void> {
      await hosting.stop(req.params.id);
      res.json({ ok: true });
    },

    start(req: IdRequest, res: Response): void {
      res.json(hosting.startExam(req.params.id));
    },

    async end(req: IdRequest, res: Response): Promise<void> {
      await hosting.endExam(req.params.id, 'manual');
      res.json({ ok: true });
    },

    info(req: IdRequest, res: Response): void {
      const info = hosting.info(req.params.id);
      if (!info) throw new ApiError(404, 'not_hosting', 'Not hosting');
      res.json(info);
    },

    /** The same data the teacher WS pushes, as a snapshot. */
    roster(req: IdRequest, res: Response): void {
      if (!exams.get(req.params.id)) throw new ApiError(404, 'not_found', 'Exam not found');
      const body: RosterResponse = {
        students: students.roster(req.params.id),
        counts: students.counts(req.params.id),
      };
      res.json(body);
    },

    /** The exam-wide switches (`terminal`, `internet`) and global actions (`extend_all`, `broadcast`). */
    action(req: IdRequest, res: Response): void {
      const body = ExamActionSchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, 'invalid_body', 'Unknown or invalid action');
      const action = body.data;
      const examId = req.params.id;
      if (action.type === 'terminal' && !action.enabled && action.minutes !== undefined) {
        throw new ApiError(400, 'invalid_body', 'Minutes only apply when turning it on');
      }
      switch (action.type) {
        case 'internet':
          return void res.json(hosting.internet.set(examId, action.enabled));
        case 'terminal':
          return void res.json(hosting.terminal.set(examId, action.enabled, action.minutes));
        case 'extend_all':
          return void res.json(hosting.globalActions.extendAll(examId, action));
        case 'broadcast':
          return void res.json(hosting.globalActions.broadcast(examId, action));
      }
    },

    /** One student: message or warning, lock, unlock, extend, end, reset session (M35). */
    studentAction(req: Request<{ id: string; sid: string }>, res: Response): void {
      const body = StudentActionSchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, 'invalid_body', 'Unknown or invalid action');
      res.json(hosting.studentActions.run(req.params.id, req.params.sid, body.data));
    },
  };
}
