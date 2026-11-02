import { Router, type RequestHandler } from 'express';
import { createExamController, type ExamControllerDeps } from '../controllers/exam.controller.js';

/** `/exams*`: list, create, edit settings, duplicate, delete and ready/unready. */
export function examRoutes(deps: ExamControllerDeps, requireLogin: RequestHandler): Router {
  const exams = createExamController(deps);
  const router = Router();
  router.get('/exams', requireLogin, exams.list);
  router.post('/exams', requireLogin, exams.create);
  router.get('/exams/:id', requireLogin, exams.get);
  router.patch('/exams/:id', requireLogin, exams.update);
  router.delete('/exams/:id', requireLogin, exams.remove);
  router.post('/exams/:id/duplicate', requireLogin, exams.duplicate);
  router.post('/exams/:id/ready', requireLogin, exams.ready);
  router.post('/exams/:id/unready', requireLogin, exams.unready);
  return router;
}
