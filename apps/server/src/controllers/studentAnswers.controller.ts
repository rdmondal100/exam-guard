import type { Request, Response } from 'express';
import type { StudentAnswersService } from '../services/answers/student-answers.js';

export interface StudentAnswersControllerDeps {
  studentAnswers: Pick<StudentAnswersService, 'sheet'>;
}

/** A student's answer sheet (M65). Works in every exam state; the service refuses other exams. */
export function createStudentAnswersController({ studentAnswers }: StudentAnswersControllerDeps) {
  return {
    get(req: Request<{ id: string; sid: string }>, res: Response): void {
      res.json(studentAnswers.sheet(req.params.id, req.params.sid));
    },
  };
}
