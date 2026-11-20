import { Router, type RequestHandler } from 'express';
import {
  createStudentAnswersController,
  type StudentAnswersControllerDeps,
} from '../controllers/studentAnswers.controller.js';

/** `GET /exams/:id/students/:sid/answers`: one student's answers, final or newest autosave. */
export function studentAnswersRoutes(
  deps: StudentAnswersControllerDeps,
  requireLogin: RequestHandler,
): Router {
  const answers = createStudentAnswersController(deps);
  const router = Router();
  router.get('/exams/:id/students/:sid/answers', requireLogin, answers.get);
  return router;
}
