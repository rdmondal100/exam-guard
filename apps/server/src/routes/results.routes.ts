import { Router, type RequestHandler } from 'express';
import {
  createResultsController,
  type ResultsControllerDeps,
} from '../controllers/results.controller.js';

/** Finalize and the results CSV (M42). */
export function resultsRoutes(deps: ResultsControllerDeps, requireLogin: RequestHandler): Router {
  const results = createResultsController(deps);
  const router = Router();
  router.post('/exams/:id/finalize', requireLogin, results.finalize);
  router.get('/exams/:id/export.csv', requireLogin, results.csv);
  router.post('/exams/:id/export', requireLogin, results.exportCsv);
  return router;
}
