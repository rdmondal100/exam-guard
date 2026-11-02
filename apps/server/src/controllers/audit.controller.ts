import type { Request, Response } from 'express';
import { MAX_AUDIT_ROWS, type AuditResponse } from '@examguard/shared';
import type { ExamRepo } from '../db/repositories/exam.repo.js';
import type { TeacherActionRepo } from '../db/repositories/teacherAction.repo.js';
import { AuditQuerySchema } from '../validators/audit.validator.js';
import { ApiError } from '../utils/ApiError.js';

export interface AuditControllerDeps {
  exams: ExamRepo;
  actions: TeacherActionRepo;
}

/** The teacher action log of one exam (M36), in any exam state. */
export function createAuditController({ exams, actions }: AuditControllerDeps) {
  return {
    list(req: Request<{ id: string }>, res: Response): void {
      const query = AuditQuerySchema.safeParse(req.query);
      if (!query.success) throw new ApiError(400, 'invalid_query', 'Invalid audit query');
      if (!exams.get(req.params.id)) throw new ApiError(404, 'not_found', 'Exam not found');
      const body: AuditResponse = {
        actions: actions.audit(req.params.id, query.data.limit ?? MAX_AUDIT_ROWS),
      };
      res.json(body);
    },
  };
}
