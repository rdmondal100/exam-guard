import { Router, type RequestHandler } from 'express';
import {
  createQuestionController,
  type QuestionControllerDeps,
} from '../controllers/question.controller.js';

/** `/exams/:id/questions*` and `/questions/:qid`. */
export function questionRoutes(deps: QuestionControllerDeps, requireLogin: RequestHandler): Router {
  const questions = createQuestionController(deps);
  const router = Router();
  router.get('/exams/:id/questions', requireLogin, questions.list);
  router.post('/exams/:id/questions', requireLogin, questions.create);
  router.post('/exams/:id/questions/reorder', requireLogin, questions.reorder);
  router.patch('/questions/:qid', requireLogin, questions.update);
  router.delete('/questions/:qid', requireLogin, questions.remove);
  return router;
}
