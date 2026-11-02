import { Router, type RequestHandler } from 'express';
import {
  createGradingController,
  type GradingControllerDeps,
} from '../controllers/grading.controller.js';

/** Grading (M38), review (M39) and accept / edit (M40). */
export function gradingRoutes(deps: GradingControllerDeps, requireLogin: RequestHandler): Router {
  const grading = createGradingController(deps);
  const router = Router();
  router.get('/exams/:id/grading', requireLogin, grading.status);
  router.post('/exams/:id/grading', requireLogin, grading.start);
  router.post('/exams/:id/grading/cancel', requireLogin, grading.cancel);
  router.get('/exams/:id/review/:qid', requireLogin, grading.table);
  router.get('/answers/:sid/:qid', requireLogin, grading.answer);
  router.post('/answers/:sid/:qid/accept', requireLogin, grading.accept);
  router.post('/answers/:sid/:qid/edit', requireLogin, grading.edit);
  return router;
}
