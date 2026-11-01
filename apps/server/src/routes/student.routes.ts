import { Router } from 'express';
import type { ExamStudentRepo } from '../db/repositories/examStudent.repo.js';
import {
  createStudentController,
  type StudentControllerDeps,
} from '../controllers/student.controller.js';
import { verifyStudent } from '../middlewares/studentAuth.middleware.js';

/**
 * The student API on the HTTPS listener: `/info`, join, and, when their deps are given, the
 * exam-file download and the stored answers (both need a session token).
 */
export function studentRoutes(deps: StudentControllerDeps & { students: ExamStudentRepo }): Router {
  const student = createStudentController(deps);
  const session = verifyStudent(deps.students);
  const router = Router();
  router.get('/info', student.info);
  router.post('/join', student.join);
  router.post('/join/confirm', student.confirm);
  if (deps.exams && deps.files) router.get('/exam-files/:fileId', session, student.examFile);
  if (deps.answers) router.get('/answers/latest', session, student.latestAnswers);
  return router;
}
